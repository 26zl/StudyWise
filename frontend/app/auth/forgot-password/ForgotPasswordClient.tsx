"use client";

import Link from "next/link";
import { useState, type SubmitEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { detectSecondFactorStrategy } from "@/app/auth/mfaStrategy";
import {
  AuthCard,
  AuthHeader,
  AuthError,
  AuthPrimaryButton,
  AuthFooterLink,
  SecuredByClerk,
  parseClerkError,
  withAuthTimeout,
  AuthTimeoutError,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";

type Gjenopprettingssteg = "identify" | "verify" | "setCredential" | "mfa";
const MFA_TIMEOUT_MS = 15_000;

type ForgotPasswordClientProps = {
  initialVerified: boolean;
};

export function ForgotPasswordClient({
  initialVerified,
}: ForgotPasswordClientProps) {
  const { t } = useLanguage();
  const { signIn, errors, fetchStatus } = useSignIn();
  const searchParams = useSearchParams();
  const redirectUrl = getPostAuthRedirectFromParams(searchParams);
  const signInHref = withPostAuthRedirect("/auth/sign-in", redirectUrl);
  const [isVerified, setIsVerified] = useState(initialVerified);
  const [isRedirectingToDashboard, setIsRedirectingToDashboard] = useState(false);

  const [steg, setSteg] = useState<Gjenopprettingssteg>("identify");
  const [epostadresse, setEpostadresse] = useState("");
  const [kode, setKode] = useState("");
  const [passord, setPassord] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const erLaster = fetchStatus === "fetching";
  const generellFeil = errors.global?.[0]?.message ?? null;
  const identifikatorFeil = errors.fields.identifier?.message ?? null;
  const kodeFeil = errors.fields.code?.message ?? null;
  const passordFeil = errors.fields.password?.message ?? null;

  async function nullstillFlyt() {
    setKode("");
    setPassord("");
    setSteg("identify");
    await signIn.reset();
  }

  async function sendKode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const identifikator = epostadresse.trim();
    if (!identifikator) {
      return;
    }

    // Server-side Turnstile-gate: verifiser at human-check er bestått før Clerk-kall
    const gateOk = await checkAuthTurnstileGate();
    if (!gateOk) {
      showToast.error(
        t("auth.humanCheck.title"),
        t("auth.humanCheck.gateError"),
      );
      return;
    }

    const { error: opprettFeil } = await signIn.create({
      identifier: identifikator,
    });
    if (opprettFeil) {
      return;
    }

    const { error: sendFeil } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendFeil) {
      return;
    }

    setSteg("verify");
    showToast.success(
      t("auth.forgotPassword.sent.emailTitle"),
      t("auth.forgotPassword.sent.emailDescription"),
    );
  }

  async function bekreftKode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const kodeTrimmet = kode.trim();
    if (!kodeTrimmet) {
      return;
    }

    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: kodeTrimmet });
    if (error) {
      return;
    }

    setSteg("setCredential");
  }

  async function lagreNyttPassord(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passord) {
      return;
    }

    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password: passord });
    if (error) {
      return;
    }

    if (signIn.status === "needs_second_factor") {
      setMfaCode("");
      setMfaError(null);
      setSteg("mfa");
      return;
    }

    if (signIn.status === "complete") {
      setIsRedirectingToDashboard(true);
      const { error: finalizeError } = await signIn.finalize();

      if (finalizeError) {
        setIsRedirectingToDashboard(false);
        return;
      }

      showToast.success(
        t("auth.forgotPassword.complete.title"),
        t("auth.forgotPassword.complete.description"),
      );
      window.location.replace(redirectUrl);
    }
  }

  async function bekreftMfa(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || mfaSubmitting) return;

    const attempt = detectSecondFactorStrategy(mfaCode);
    if (!attempt) {
      setMfaError(t("auth.signIn.mfa.codeRequired"));
      return;
    }

    setMfaSubmitting(true);
    setMfaError(null);

    try {
      const { error } = await withAuthTimeout(
        attempt.strategy === "totp"
          ? signIn.mfa.verifyTOTP({ code: attempt.code })
          : signIn.mfa.verifyBackupCode({ code: attempt.code }),
        MFA_TIMEOUT_MS,
        "forgot_password_mfa_attempt",
      );

      if (error) {
        setMfaError(parseClerkError(error, t("auth.signIn.mfa.verificationFailed")));
        return;
      }

      if (signIn.status === "complete") {
        setIsRedirectingToDashboard(true);
        const { error: finalizeError } = await withAuthTimeout(
          signIn.finalize(),
          MFA_TIMEOUT_MS,
          "forgot_password_mfa_finalize",
        );

        if (finalizeError) {
          setIsRedirectingToDashboard(false);
          setMfaError(parseClerkError(finalizeError, t("auth.signIn.mfa.verificationFailed")));
          return;
        }

        showToast.success(
          t("auth.forgotPassword.complete.title"),
          t("auth.forgotPassword.complete.description"),
        );
        window.location.replace(redirectUrl);
        return;
      }

      setMfaError(t("auth.signIn.mfa.verificationFailed"));
    } catch (err) {
      if (signIn.status === "complete") {
        setIsRedirectingToDashboard(true);
        try {
          await withAuthTimeout(signIn.finalize(), MFA_TIMEOUT_MS, "forgot_password_mfa_recover_finalize");
        } catch {
          // falle gjennom til redirect
        }
        window.location.replace(redirectUrl);
        return;
      }

      if (err instanceof AuthTimeoutError) {
        setMfaError(t("errors.generic.timeout"));
      } else {
        setMfaError(parseClerkError(err, t("auth.signIn.mfa.verificationFailed")));
      }
    } finally {
      setMfaSubmitting(false);
    }
  }

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirecting"
          />
        </AuthCard>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-4">
      <AuthTurnstileInline
        initialVerified={initialVerified}
        onVerified={() => {
          setIsVerified(true);
        }}
      />

      {isVerified && (
        <>
          {/* Steg 1: Identifiser konto */}
          {steg === "identify" && (
            <>
              <AuthCard>
                <AuthHeader
                  title={t("auth.forgotPassword.title")}
                  subtitle={t("auth.forgotPassword.description")}
                />

                <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {t("auth.forgotPassword.thirdParty.title")}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {t("auth.forgotPassword.thirdParty.description")}
                  </p>
                </div>

                <form className="space-y-4" onSubmit={sendKode} noValidate>
                  <div>
                    <label htmlFor="email" className={AUTH_LABEL_CLASSES}>
                      {t("auth.forgotPassword.identifier.emailLabel")}
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      aria-required="true"
                      aria-invalid={!!identifikatorFeil}
                      aria-describedby={identifikatorFeil ? "email-error" : undefined}
                      value={epostadresse}
                      onChange={(event) => setEpostadresse(event.target.value)}
                      placeholder={t("auth.forgotPassword.identifier.emailPlaceholder")}
                      className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                    />
                    {identifikatorFeil && (
                      <p id="email-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {identifikatorFeil}
                      </p>
                    )}
                  </div>

                  <AuthError message={generellFeil} />

                  <AuthPrimaryButton isLoading={erLaster} loadingText={t("common.actions.sendCode")}>
                    {t("common.actions.sendCode")}
                  </AuthPrimaryButton>
                </form>

                <AuthFooterLink
                  text={t("auth.forgotPassword.support")}
                  linkText={t("common.actions.backToSignIn")}
                  href={signInHref}
                />
              </AuthCard>
            </>
          )}

          {/* Steg 2: Bekreft kode */}
          {steg === "verify" && (
            <AuthCard>
              <AuthHeader
                title={t("auth.forgotPassword.steps.verify")}
                subtitle={t("auth.forgotPassword.code.descriptionEmail")}
              />

              <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                {t("auth.forgotPassword.sent.emailTitle")}
              </div>

              <form className="space-y-4" onSubmit={bekreftKode} noValidate>
                <div>
                  <label htmlFor="code" className={AUTH_LABEL_CLASSES}>
                    {t("auth.forgotPassword.code.label")}
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    aria-required="true"
                    aria-invalid={!!kodeFeil}
                    aria-describedby={kodeFeil ? "code-error" : undefined}
                    value={kode}
                    onChange={(event) => setKode(event.target.value)}
                    placeholder={t("auth.forgotPassword.code.placeholder")}
                    className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  />
                  {kodeFeil && (
                    <p id="code-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {kodeFeil}
                    </p>
                  )}
                </div>

                <AuthError message={generellFeil} />

                <AuthPrimaryButton isLoading={erLaster} loadingText={t("common.actions.verifyCode")}>
                  {t("common.actions.verifyCode")}
                </AuthPrimaryButton>

                <button
                  type="button"
                  disabled={erLaster}
                  onClick={() => {
                    void nullstillFlyt();
                  }}
                  className="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {t("common.actions.change")}
                </button>
              </form>
            </AuthCard>
          )}

          {/* Steg 3: Nytt passord */}
          {steg === "setCredential" && (
            <AuthCard>
              <AuthHeader
                title={t("auth.forgotPassword.steps.setCredential")}
                subtitle={t("auth.forgotPassword.setCredential.description")}
              />

              <form className="space-y-4" onSubmit={lagreNyttPassord} noValidate>
                <div>
                  <label htmlFor="password" className={AUTH_LABEL_CLASSES}>
                    {t("auth.forgotPassword.setCredential.label")}
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    aria-required="true"
                    aria-invalid={!!passordFeil}
                    aria-describedby={passordFeil ? "password-error" : undefined}
                    value={passord}
                    onChange={(event) => setPassord(event.target.value)}
                    placeholder={t("auth.forgotPassword.setCredential.placeholder")}
                    className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  />
                  {passordFeil && (
                    <p id="password-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {passordFeil}
                    </p>
                  )}
                </div>

                <AuthError message={generellFeil} />

                <AuthPrimaryButton isLoading={erLaster} loadingText={t("common.actions.completeReset")}>
                  {t("common.actions.completeReset")}
                </AuthPrimaryButton>
              </form>
            </AuthCard>
          )}

          {/* Steg 4: MFA nødvendig */}
          {steg === "mfa" && (
            <AuthCard>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-100 p-2 dark:bg-blue-900/40">
                  <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                </div>
                <AuthHeader
                  title={t("auth.forgotPassword.mfa.title")}
                  subtitle={t("auth.forgotPassword.mfa.description")}
                />
              </div>

              <form className="mt-4 space-y-4" onSubmit={bekreftMfa} noValidate>
                <div>
                  <label htmlFor="forgot-password-mfa-code" className={AUTH_LABEL_CLASSES}>
                    {t("auth.signIn.mfa.codeLabel")}
                  </label>
                  <input
                    id="forgot-password-mfa-code"
                    type="text"
                    autoComplete="one-time-code"
                    autoFocus
                    aria-required="true"
                    aria-invalid={!!mfaError}
                    aria-describedby={mfaError ? "forgot-password-mfa-error" : undefined}
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    placeholder={t("auth.signIn.mfa.codePlaceholder")}
                    className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                    disabled={mfaSubmitting}
                  />
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {t("auth.signIn.mfa.codeHint")}
                  </p>
                </div>

                <div id="forgot-password-mfa-error">
                  <AuthError message={mfaError ?? generellFeil} />
                </div>

                <AuthPrimaryButton
                  isLoading={mfaSubmitting}
                  loadingText={t("auth.signIn.mfa.verifying")}
                >
                  {t("auth.signIn.mfa.verifyButton")}
                </AuthPrimaryButton>
              </form>

              <Link
                href={signInHref}
                prefetch={false}
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("auth.signIn.mfa.backToSignIn")}
              </Link>
            </AuthCard>
          )}
        </>
      )}

      <SecuredByClerk label={t("auth.securedByClerk")} />
    </div>
  );
}

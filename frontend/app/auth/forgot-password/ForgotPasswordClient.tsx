"use client";

import Link from "next/link";
import { useState, type SubmitEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import {
  AuthCard,
  AuthHeader,
  AuthError,
  AuthPrimaryButton,
  AuthFooterLink,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";

type Gjenopprettingssteg = "identify" | "verify" | "setCredential" | "mfa";

type ForgotPasswordClientProps = {
  initialVerified: boolean;
};

export function ForgotPasswordClient({
  initialVerified,
}: ForgotPasswordClientProps) {
  const { t } = useLanguage();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const [isRedirectingToDashboard, setIsRedirectingToDashboard] = useState(false);

  const [steg, setSteg] = useState<Gjenopprettingssteg>("identify");
  const [epostadresse, setEpostadresse] = useState("");
  const [kode, setKode] = useState("");
  const [passord, setPassord] = useState("");

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
      window.location.replace("/dashboard");
    }
  }

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirectingToDashboard"
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
                  href="/auth/sign-in"
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

          {/* MFA nødvendig */}
          {steg === "mfa" && (
            <AuthCard>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/60 dark:text-amber-100">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {t("auth.forgotPassword.mfa.title")}
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {t("auth.forgotPassword.mfa.description")}
                  </p>
                </div>
              </div>

              <Link
                href="/auth/sign-in"
                prefetch={false}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {t("common.actions.backToSignIn")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </AuthCard>
          )}
        </>
      )}
    </div>
  );
}

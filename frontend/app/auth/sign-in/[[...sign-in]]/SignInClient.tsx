"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSignIn } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { useLanguage } from "@/app/i18n";
import { LoadingView } from "@/app/components/ui/Loading";
import {
  parseClerkError,
  AuthCard,
  AuthHeader,
  AuthOAuthButtons,
  AuthDivider,
  AuthError,
  AuthPrimaryButton,
  AuthFooterLink,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";

type SignInClientProps = {
  initialVerified: boolean;
};

export function SignInClient({ initialVerified }: SignInClientProps) {
  const { t } = useLanguage();
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn, setActive } = useSignIn();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const isRedirectingToDashboard = isLoaded && isSignedIn;

  // Vis feilmelding fra URL-parameter (f.eks. etter auth-konflikt redirect)
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(urlError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);

  // MFA (TOTP) — aktiveres når Clerk returnerer needs_second_factor
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || isSubmitting) return;

      const trimmedId = identifier.trim();
      if (!trimmedId || !password) {
        setFormError(t("auth.signIn.allFieldsRequired"));
        return;
      }

      setIsSubmitting(true);
      setFormError(null);

      try {
        // Server-side Turnstile-gate: verifiser at human-check er bestått før Clerk-kall
        const gateOk = await checkAuthTurnstileGate();
        if (!gateOk) {
          setFormError(t("auth.humanCheck.gateError"));
          return;
        }

        const result = await signIn.create({
          identifier: trimmedId,
          password,
        });

        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          window.location.replace("/dashboard");
        } else if (result.status === "needs_second_factor") {
          setMfaStep(true);
          setFormError(null);
        } else if (result.status === "complete") {
          setFormError(t("auth.signIn.sessionFailed"));
        } else {
          setFormError(t("auth.signIn.incomplete"));
        }
      } catch (err) {
        setFormError(parseClerkError(err, t("auth.genericError")));
      } finally {
        setIsSubmitting(false);
      }
    },
    [signIn, setActive, identifier, password, isSubmitting, t],
  );

  // MFA: verifiser TOTP-kode
  const handleMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || mfaSubmitting) return;

      const code = mfaCode.trim();
      if (!code) {
        setMfaError(t("auth.signIn.mfa.codeRequired"));
        return;
      }

      setMfaSubmitting(true);
      setMfaError(null);

      try {
        const result = await signIn.attemptSecondFactor({
          strategy: "totp",
          code,
        });

        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          window.location.replace("/dashboard");
        } else {
          setMfaError(t("auth.signIn.mfa.verificationFailed"));
        }
      } catch (err) {
        setMfaError(parseClerkError(err, t("auth.signIn.mfa.verificationFailed")));
      } finally {
        setMfaSubmitting(false);
      }
    },
    [signIn, setActive, mfaCode, mfaSubmitting, t],
  );

  const handleOAuth = useCallback(
    async (strategy: "oauth_google" | "oauth_microsoft") => {
      if (!signIn || isOAuthSubmitting) return;
      setFormError(null);
      setIsOAuthSubmitting(true);

      try {
        // Server-side Turnstile-gate: verifiser at human-check er bestått før OAuth-redirect
        const gateOk = await checkAuthTurnstileGate();
        if (!gateOk) {
          setFormError(t("auth.humanCheck.gateError"));
          setIsOAuthSubmitting(false);
          return;
        }

        await signIn.authenticateWithRedirect({
          strategy,
          redirectUrl: "/auth/sign-in/sso-callback",
          redirectUrlComplete: "/dashboard",
        });
      } catch (err) {
        setFormError(parseClerkError(err, t("auth.genericError")));
        setIsOAuthSubmitting(false);
      }
    },
    [signIn, isOAuthSubmitting, t],
  );

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
        onVerified={() => setIsVerified(true)}
      />

      {isVerified && mfaStep && (
        <AuthCard>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-2 dark:bg-blue-900/40">
              <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </div>
            <AuthHeader
              title={t("auth.signIn.mfa.title")}
              subtitle={t("auth.signIn.mfa.subtitle")}
            />
          </div>

          <form onSubmit={handleMfa} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="mfa-code" className={AUTH_LABEL_CLASSES}>
                {t("auth.signIn.mfa.codeLabel")}
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={t("auth.signIn.mfa.codePlaceholder")}
                className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                autoFocus
                disabled={mfaSubmitting}
                maxLength={6}
              />
            </div>

            <AuthError message={mfaError} />

            <AuthPrimaryButton
              isLoading={mfaSubmitting}
              loadingText={t("auth.signIn.mfa.verifying")}
            >
              {t("auth.signIn.mfa.verifyButton")}
            </AuthPrimaryButton>
          </form>

          <button
            type="button"
            onClick={() => {
              setMfaStep(false);
              setMfaCode("");
              setMfaError(null);
            }}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("auth.signIn.mfa.backToSignIn")}
          </button>
        </AuthCard>
      )}

      {isVerified && !mfaStep && (
        <>
          <AuthCard>
            <AuthHeader
              title={t("auth.signIn.title")}
              subtitle={t("auth.signIn.subtitle")}
            />

            <AuthOAuthButtons
              onGoogle={() => void handleOAuth("oauth_google")}
              onMicrosoft={() => void handleOAuth("oauth_microsoft")}
              disabled={isSubmitting || isOAuthSubmitting}
            />

            <AuthDivider text={t("auth.signIn.orContinueWith")} />

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="signin-identifier" className={AUTH_LABEL_CLASSES}>
                  {t("auth.signIn.identifierLabel")}
                </label>
                <input
                  id="signin-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t("auth.signIn.identifierPlaceholder")}
                  className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  autoComplete="username email"
                  autoFocus
                  disabled={isSubmitting || isOAuthSubmitting}
                />
              </div>

              <div>
                <label htmlFor="signin-password" className={AUTH_LABEL_CLASSES}>
                  {t("auth.signIn.passwordLabel")}
                </label>
                <input
                  id="signin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.signIn.passwordPlaceholder")}
                  className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  autoComplete="current-password"
                  disabled={isSubmitting || isOAuthSubmitting}
                />
              </div>

              <AuthError message={formError} />

              <AuthPrimaryButton
                isLoading={isSubmitting}
                loadingText={t("auth.signIn.submitting")}
                disabled={isOAuthSubmitting}
              >
                {t("auth.signIn.submitButton")}
              </AuthPrimaryButton>
            </form>

            <AuthFooterLink
              text={t("auth.signIn.noAccount")}
              linkText={t("auth.signIn.signUpLink")}
              href="/auth/sign-up"
            />
          </AuthCard>

          <AuthCard>
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                {t("auth.signIn.forgotPasswordTitle")}
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("auth.signIn.forgotPasswordDescription")}
              </p>
            </div>

            <Link
              href="/auth/forgot-password"
              prefetch={false}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
            >
              {t("auth.signIn.forgotPasswordAction")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </AuthCard>
        </>
      )}
    </div>
  );
}

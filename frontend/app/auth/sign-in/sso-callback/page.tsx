"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";
import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";
import {
  AuthCard,
  AuthHeader,
  AuthError,
  AuthPrimaryButton,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";
import { useSSOCallback } from "@/app/auth/useSSOCallback";

export default function SignInSSOCallbackPage() {
  const { t } = useLanguage();
  const {
    callbackError,
    oauthConflict,
    signInHref,
    needsMfa,
    mfaCode,
    setMfaCode,
    mfaError,
    mfaSubmitting,
    handleMfa,
  } = useSSOCallback("sign-in");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      {/* Påkrevd for Clerks bot-registreringsbeskyttelse */}
      <div id="clerk-captcha" className="flex justify-center" />
      <div className="w-full max-w-md space-y-4">
        {/* MFA nødvendig etter SSO-innlogging */}
        {needsMfa ? (
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
                  // Aksepterer både TOTP (6 sifre) og backup-koder (10 alfanumeriske)
                  // — strategi velges av detectSecondFactorStrategy ved submit.
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder={t("auth.signIn.mfa.codePlaceholder")}
                  className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  autoFocus
                  disabled={mfaSubmitting}
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("auth.signIn.mfa.codeHint")}
                </p>
              </div>

              <AuthError message={mfaError} />

              <AuthPrimaryButton
                isLoading={mfaSubmitting}
                loadingText={t("auth.signIn.mfa.verifying")}
              >
                {t("auth.signIn.mfa.verifyButton")}
              </AuthPrimaryButton>
            </form>

            <Link
              href={signInHref}
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("auth.signIn.mfa.backToSignIn")}
            </Link>

            <p className="mt-4 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("auth.signIn.mfa.lostAccess")}{" "}
              <Link
                href="/kontakt"
                prefetch={false}
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t("auth.signIn.mfa.lostAccessLink")}
              </Link>
            </p>
          </AuthCard>
        ) : (
          <AuthCard>
            {oauthConflict ? (
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                  <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {t("auth.signUp.oauthConflict.title")}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t("auth.signUp.oauthConflict.description")}
                  </p>
                </div>
                <Link
                  href={signInHref}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  {t("auth.signUp.oauthConflict.backToSignIn")}
                </Link>
              </div>
            ) : callbackError ? (
              <div className="space-y-2 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t("auth.genericError")}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t("common.loading.redirecting")}
                </p>
              </div>
            ) : (
              <LoadingView
                fullPage={false}
                translationKey="common.loading.redirecting"
              />
            )}
          </AuthCard>
        )}
        <noscript>
          <AuthCard>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("auth.genericError")}{" "}
              <Link href={signInHref} className="font-semibold text-blue-600 dark:text-blue-400">
                {t("auth.signIn.submitButton")}
              </Link>
            </p>
          </AuthCard>
        </noscript>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";
import { AuthCard } from "@/app/auth/authUI";
import { useSSOCallback } from "@/app/auth/useSSOCallback";

export default function SignInSSOCallbackPage() {
  const { t } = useLanguage();
  const { callbackError, oauthConflict, signInHref } = useSSOCallback("sign-in");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      {/* Påkrevd for Clerks bot-registreringsbeskyttelse */}
      <div id="clerk-captcha" />
      <div className="w-full max-w-md space-y-4">
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

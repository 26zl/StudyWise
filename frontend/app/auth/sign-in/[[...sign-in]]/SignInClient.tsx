"use client";

import Link from "next/link";
import { useState } from "react";
import { SignIn, useAuth } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { useLanguage } from "@/app/i18n";
import { clerkAppearance } from "@/app/auth/clerkAppearance";
import { LoadingView } from "@/app/components/ui/Loading";

type SignInClientProps = {
  initialVerified: boolean;
};

export function SignInClient({ initialVerified }: SignInClientProps) {
  const { language, t } = useLanguage();
  const { isLoaded, isSignedIn } = useAuth();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const isRedirectingToDashboard = isLoaded && isSignedIn;

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-lg dark:border-slate-700 dark:bg-slate-800/95">
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirectingToDashboard"
          />
        </div>
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
          <SignIn
            key={language}
            appearance={clerkAppearance}
            signUpUrl="/auth/sign-up"
            forceRedirectUrl="/dashboard"
          />

          <div className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-lg dark:border-slate-700 dark:bg-slate-800/95">
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
          </div>
        </>
      )}
    </div>
  );
}

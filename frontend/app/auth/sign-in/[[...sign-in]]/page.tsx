/*
 * Dedikert Clerk innloggingsside.
 * Farger matcher resten av appen (slate, blue).
 */
"use client";

import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { clerkAppearance } from "@/app/auth/clerkAppearance";

export default function SignInPage() {
  const { language, t } = useLanguage();

  return (
    <div className="w-full max-w-md space-y-4">
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
    </div>
  );
}

"use client";

import { useState } from "react";
import { SignUp, useAuth } from "@clerk/nextjs";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { useLanguage } from "@/app/i18n";
import { clerkAppearance } from "@/app/auth/clerkAppearance";
import { LoadingView } from "@/app/components/ui/Loading";

type SignUpClientProps = {
  initialVerified: boolean;
};

export function SignUpClient({ initialVerified }: SignUpClientProps) {
  const { language } = useLanguage();
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
        <SignUp
          key={language}
          appearance={clerkAppearance}
          signInUrl="/auth/sign-in"
          forceRedirectUrl="/dashboard"
        />
      )}
    </div>
  );
}

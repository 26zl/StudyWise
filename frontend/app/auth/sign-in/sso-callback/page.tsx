"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";
import { AuthCard } from "@/app/auth/authUI";

export default function SignInSSOCallbackPage() {
  const { t } = useLanguage();
  const clerk = useClerk();
  const { signIn, setActive } = useSignIn();
  const { signUp } = useSignUp();
  const handledRef = useRef(false);
  const [callbackError, setCallbackError] = useState(false);

  useEffect(() => {
    if (!clerk.loaded || !signIn || !signUp || handledRef.current) return;
    handledRef.current = true;

    const handleCallback = async () => {
      try {
        // La Clerk prosessere OAuth-tokenet fra URL
        await clerk.handleRedirectCallback({
          signInForceRedirectUrl: "/dashboard",
          signUpForceRedirectUrl: "/dashboard",
          signInUrl: "/auth/sign-in",
          signUpUrl: "/auth/sign-up",
          continueSignUpUrl: "/auth/sign-up?oauth=complete",
          firstFactorUrl: "/auth/sign-in",
          secondFactorUrl: "/auth/sign-in",
        });
      } catch {
        // handleRedirectCallback feilet — sjekk om det er en "transferable" case
        // (ny bruker prøvde å logge inn via OAuth → Clerk opprettet sign-up i stedet)
        const externalStatus = signIn.firstFactorVerification?.status;
        const signUpExternalStatus = signUp.verifications?.externalAccount?.status;

        if (signUpExternalStatus === "transferable") {
          // Ny bruker fra sign-in → fullførte sign-up, overfør til sign-in
          try {
            const result = await signIn.create({ transfer: true });
            if (result.status === "complete" && result.createdSessionId) {
              await setActive({ session: result.createdSessionId });
              window.location.replace("/dashboard");
              return;
            }
          } catch {
            // Transfer feilet — faller gjennom til feilhåndtering
          }
        } else if (externalStatus === "transferable") {
          // Eksisterende bruker — sign-in er "transferable", fullfør sign-up
          try {
            const result = await signUp.create({ transfer: true });
            if (result.status === "complete" && result.createdSessionId) {
              await setActive({ session: result.createdSessionId });
              window.location.replace("/dashboard");
              return;
            }
          } catch {
            // Transfer feilet — faller gjennom til feilhåndtering
          }
        }

        // Sjekk om sign-in faktisk fullførte (session satt av handleRedirectCallback)
        if (clerk.session) {
          window.location.replace("/dashboard");
          return;
        }
        setCallbackError(true);
        setTimeout(() => {
          window.location.replace("/auth/sign-in");
        }, 2000);
      }
    };

    void handleCallback();
  }, [clerk, signIn, signUp, setActive]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {/* Påkrevd for Clerks bot-registreringsbeskyttelse */}
      <div id="clerk-captcha" />
      <div className="w-full max-w-md space-y-4">
        <AuthCard>
          {callbackError ? (
            <div className="space-y-2 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("auth.genericError")}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("common.loading.redirectingToDashboard")}
              </p>
            </div>
          ) : (
            <LoadingView
              fullPage={false}
              translationKey="common.loading.redirectingToDashboard"
            />
          )}
        </AuthCard>
        <noscript>
          <AuthCard>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("auth.genericError")}{" "}
              <Link href="/auth/sign-in" className="font-semibold text-blue-600 dark:text-blue-400">
                {t("auth.signIn.submitButton")}
              </Link>
            </p>
          </AuthCard>
        </noscript>
      </div>
    </div>
  );
}

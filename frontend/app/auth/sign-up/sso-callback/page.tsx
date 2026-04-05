"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { AlertTriangle } from "lucide-react";
import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";
import { AuthCard } from "@/app/auth/authUI";
import { fetchApi } from "@/app/lib/apiClient";

export default function SSOCallbackPage() {
  const { t } = useLanguage();
  const clerk = useClerk();
  const { signUp, setActive } = useSignUp();
  const { signIn } = useSignIn();
  const handledRef = useRef(false);
  const [callbackError, setCallbackError] = useState(false);
  const [oauthConflict, setOauthConflict] = useState(false);

  useEffect(() => {
    if (!clerk.loaded || !signUp || !signIn || handledRef.current) return;
    handledRef.current = true;

    // Sjekk for OAuth-konto-konflikt før redirect til dashboard
    const redirectOrConflict = async () => {
      try {
        const res = await fetchApi("/api/user/me", { method: "GET" });
        if (res.status === 409) {
          const json = await res.json().catch(() => ({}));
          if (
            json?.error === "oauth_account_conflict" ||
            json?.error === "oauth_metadata_missing"
          ) {
            await clerk.signOut().catch(() => {});
            setOauthConflict(true);
            return;
          }
        }
      } catch {
        // Nettverksfeil — redirect til dashboard uansett
      }
      window.location.replace("/dashboard");
    };

    const SSO_CALLBACK_TIMEOUT_MS = 15_000;

    const handleCallback = async () => {
      try {
        // La Clerk prosessere OAuth-tokenet fra URL, med timeout for å unngå evig spinner
        const callbackResult = await Promise.race([
          clerk.handleRedirectCallback({
            signUpForceRedirectUrl: "/auth/sign-up?oauth=complete",
            signInForceRedirectUrl: "/dashboard",
            signUpUrl: "/auth/sign-up",
            signInUrl: "/auth/sign-in",
            continueSignUpUrl: "/auth/sign-up?oauth=complete",
            firstFactorUrl: "/auth/sign-in",
            secondFactorUrl: "/auth/sign-in",
          }),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), SSO_CALLBACK_TIMEOUT_MS),
          ),
        ]);
        if (callbackResult === "timeout") throw new Error("SSO callback timeout");
      } catch {
        // handleRedirectCallback feilet — sjekk om det er en "transferable" case
        // (eksisterende bruker prøvde å registrere seg via OAuth)
        const externalStatus = signUp.verifications?.externalAccount?.status;

        if (externalStatus === "transferable") {
          // Bruker finnes allerede — overfør til sign-in
          try {
            const result = await signIn.create({ transfer: true });
            if (result.status === "complete" && result.createdSessionId) {
              await setActive({ session: result.createdSessionId });
              await redirectOrConflict();
              return;
            }
          } catch {
            // Transfer feilet — faller gjennom til feilhåndtering
          }
        }

        // Sjekk om sign-up faktisk fullførte (session satt av handleRedirectCallback)
        if (clerk.session) {
          await redirectOrConflict();
          return;
        }
        setCallbackError(true);
        setTimeout(() => {
          window.location.replace("/auth/sign-up");
        }, 2000);
      }
    };

    void handleCallback();
  }, [clerk, signUp, signIn, setActive]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
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
                href="/auth/sign-in"
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
              <Link href="/auth/sign-up" className="font-semibold text-blue-600 dark:text-blue-400">
                {t("auth.signUp.signInLink")}
              </Link>
            </p>
          </AuthCard>
        </noscript>
      </div>
    </div>
  );
}

"use client";

/**
 * Delt hook for SSO-callback-logikk.
 * Brukes av både sign-in og sign-up SSO-callback-sider.
 *
 * Håndterer: OAuth-token-prosessering, Clerk-redirect-callback,
 * transfer-flows, konflikthåndtering og feil-redirects.
 */

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import { appendQueryParam, getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
import { useLanguage } from "@/app/i18n";
import { fetchApi } from "@/app/lib/apiClient";

const SSO_CALLBACK_TIMEOUT_MS = 15_000;

type SSOCallbackMode = "sign-in" | "sign-up";

interface SSOCallbackResult {
  callbackError: boolean;
  oauthConflict: boolean;
  redirectUrl: string;
  signInHref: string;
  signUpHref: string;
}

export function useSSOCallback(mode: SSOCallbackMode): SSOCallbackResult {
  const { t } = useLanguage();
  const clerk = useClerk();
  const { signIn, setActive: setActiveSignIn } = useSignIn();
  const { signUp, setActive: setActiveSignUp } = useSignUp();
  const searchParams = useSearchParams();
  const redirectUrl = getPostAuthRedirectFromParams(searchParams);
  const signInHref = withPostAuthRedirect("/auth/sign-in", redirectUrl);
  const signUpHref = withPostAuthRedirect("/auth/sign-up", redirectUrl);
  const continueSignUpHref = withPostAuthRedirect("/auth/sign-up?oauth=complete", redirectUrl);
  const handledRef = useRef(false);
  const [callbackError, setCallbackError] = useState(false);
  const [oauthConflict, setOauthConflict] = useState(false);

  useEffect(() => {
    if (!clerk.loaded || !signIn || !signUp || handledRef.current) return;
    handledRef.current = true;

    const setActive = mode === "sign-in" ? setActiveSignIn : setActiveSignUp;
    if (!setActive) return;

    const redirectOrConflict = async () => {
      try {
        const res = await fetchApi("/api/user/me", { method: "GET" });
        if (res.status === 409 || res.status === 403) {
          const json = await res.json().catch(() => ({}));
          const errorType = typeof json?.error === "string" ? json.error : undefined;
          if (
            errorType === "oauth_account_conflict" ||
            errorType === "oauth_metadata_missing"
          ) {
            await clerk.signOut().catch(() => {});
            setOauthConflict(true);
            return;
          }
          // username_conflict: redirect til sign-up slik at brukeren kan velge nytt brukernavn
          if (errorType === "username_conflict") {
            await clerk.signOut().catch(() => {});
            window.location.replace(
              appendQueryParam(signUpHref, "error", t("auth.conflictRedirect.usernameConflict")),
            );
            return;
          }
          // Andre konflikter: redirect til sign-in med i18n-melding
          const errorMessageMap: Record<string, string> = {
            account_conflict: t("auth.conflictRedirect.accountConflict"),
            user_deleted: t("auth.conflictRedirect.accountDeleted"),
            user_locked: t("auth.conflictRedirect.accountLocked"),
          };
          if (errorType && errorType in errorMessageMap) {
            await clerk.signOut().catch(() => {});
            window.location.replace(
              appendQueryParam(signInHref, "error", errorMessageMap[errorType]),
            );
            return;
          }
          if (errorType === "turnstile_required") {
            window.location.replace(redirectUrl);
            return;
          }
        }
      } catch {
        // Nettverksfeil — redirect til dashboard uansett, konflikten fanges der
      }
      window.location.replace(redirectUrl);
    };

    const handleCallback = async () => {
      try {
        const callbackOpts = mode === "sign-in"
          ? {
              signInForceRedirectUrl: redirectUrl,
              signUpForceRedirectUrl: redirectUrl,
              signInUrl: signInHref,
              signUpUrl: signUpHref,
              continueSignUpUrl: continueSignUpHref,
              firstFactorUrl: signInHref,
              secondFactorUrl: signInHref,
            }
          : {
              signUpForceRedirectUrl: continueSignUpHref,
              signInForceRedirectUrl: redirectUrl,
              signUpUrl: signUpHref,
              signInUrl: signInHref,
              continueSignUpUrl: continueSignUpHref,
              firstFactorUrl: signInHref,
              secondFactorUrl: signInHref,
            };

        const callbackResult = await Promise.race([
          clerk.handleRedirectCallback(callbackOpts),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), SSO_CALLBACK_TIMEOUT_MS),
          ),
        ]);
        if (callbackResult === "timeout") throw new Error("SSO callback timeout");
      } catch {
        // handleRedirectCallback feilet — sjekk transfer-cases
        if (mode === "sign-in") {
          // Sign-in: sjekk begge retninger
          const signUpExternalStatus = signUp.verifications?.externalAccount?.status;
          const signInExternalStatus = signIn.firstFactorVerification?.status;

          if (signUpExternalStatus === "transferable") {
            try {
              const result = await signIn.create({ transfer: true });
              if (result.status === "complete" && result.createdSessionId) {
                await setActive({ session: result.createdSessionId });
                await redirectOrConflict();
                return;
              }
            } catch { /* faller gjennom */ }
          } else if (signInExternalStatus === "transferable") {
            try {
              const result = await signUp.create({ transfer: true });
              if (result.status === "complete" && result.createdSessionId) {
                await setActive({ session: result.createdSessionId });
                await redirectOrConflict();
                return;
              }
            } catch { /* faller gjennom */ }
          }
        } else {
          // Sign-up: sjekk kun sign-up → sign-in transfer
          const externalStatus = signUp.verifications?.externalAccount?.status;
          if (externalStatus === "transferable") {
            try {
              const result = await signIn.create({ transfer: true });
              if (result.status === "complete" && result.createdSessionId) {
                await setActive({ session: result.createdSessionId });
                await redirectOrConflict();
                return;
              }
            } catch { /* faller gjennom */ }
          }
        }

        // Sjekk om sesjonen faktisk ble satt
        if (clerk.session) {
          await redirectOrConflict();
          return;
        }
        setCallbackError(true);
        const fallbackHref = mode === "sign-in" ? signInHref : signUpHref;
        setTimeout(() => {
          window.location.replace(fallbackHref);
        }, 2000);
      }
    };

    void handleCallback();
  }, [clerk, signIn, signUp, setActiveSignIn, setActiveSignUp, redirectUrl, signInHref, signUpHref, continueSignUpHref, mode, t]);

  return { callbackError, oauthConflict, redirectUrl, signInHref, signUpHref };
}

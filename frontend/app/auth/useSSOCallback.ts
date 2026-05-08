"use client";

/**
 * Delt hook for SSO-callback-logikk.
 * Brukes av både sign-in og sign-up SSO-callback-sider.
 *
 * Håndterer: OAuth-token-prosessering, Clerk-redirect-callback,
 * transfer-flows, konflikthåndtering, MFA (TOTP/backup-kode) og feil-redirects.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import { appendQueryParam, getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
import { parseClerkError, withAuthTimeout, AuthTimeoutError } from "@/app/auth/authUI";
import { detectSecondFactorStrategy } from "@/app/auth/mfaStrategy";
import { useLanguage } from "@/app/i18n";
import { fetchApi } from "@/app/lib/apiClient";

const SSO_CALLBACK_TIMEOUT_MS = 15_000;
const MFA_TIMEOUT_MS = 15_000;

type SSOCallbackMode = "sign-in" | "sign-up";

interface SSOCallbackResult {
  callbackError: boolean;
  oauthConflict: boolean;
  redirectUrl: string;
  signInHref: string;
  signUpHref: string;
  /** MFA kreves etter SSO-innlogging */
  needsMfa: boolean;
  mfaCode: string;
  setMfaCode: (code: string) => void;
  mfaError: string | null;
  mfaSubmitting: boolean;
  handleMfa: (e: React.FormEvent) => Promise<void>;
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

  // MFA state
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const redirectOrConflict = useCallback(async () => {
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
  }, [clerk, signUpHref, signInHref, redirectUrl, t]);

  // MFA: verifiser TOTP-kode etter SSO-innlogging
  const handleMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || mfaSubmitting) return;

      // Auto-detekter TOTP (6 sifre) eller backup-kode (alfanumerisk). Samme
      // input-felt brukes for begge, og Clerk gir tydelig feilmelding hvis
      // koden ikke matcher noen registrert second factor.
      const attempt = detectSecondFactorStrategy(mfaCode);
      if (!attempt) {
        setMfaError(t("auth.signIn.mfa.codeRequired"));
        return;
      }

      setMfaSubmitting(true);
      setMfaError(null);

      try {
        const result = await withAuthTimeout(
          signIn.attemptSecondFactor(attempt),
          MFA_TIMEOUT_MS,
          "sso_mfa_attempt",
        );

        if (result.status === "complete" && result.createdSessionId) {
          try {
            await withAuthTimeout(
              setActiveSignIn({ session: result.createdSessionId }),
              MFA_TIMEOUT_MS,
              "sso_mfa_setactive",
            );
          } catch {
            // setActive kan henge; fortsett til redirect likevel — session er satt
          }
          await redirectOrConflict();
        } else {
          setMfaError(t("auth.signIn.mfa.verificationFailed"));
        }
      } catch (err) {
        // Recovery: hvis signIn faktisk er komplett, fullfør flyten istedenfor å vise feil
        if (signIn.status === "complete" && signIn.createdSessionId) {
          try {
            await withAuthTimeout(
              setActiveSignIn({ session: signIn.createdSessionId }),
              MFA_TIMEOUT_MS,
              "sso_mfa_recover_setactive",
            );
          } catch {
            // falle gjennom
          }
          await redirectOrConflict();
          return;
        }
        // Bruk sanert Clerk-parser i stedet for rå err.message (info-lekkasje).
        // AuthTimeoutError har en intern label ("sso_mfa_attempt_timeout") som
        // vi ikke vil vise til bruker — oversett til generisk timeout-melding.
        if (err instanceof AuthTimeoutError) {
          setMfaError(t("errors.generic.timeout"));
        } else {
          setMfaError(parseClerkError(err, t("auth.signIn.mfa.verificationFailed")));
        }
      } finally {
        setMfaSubmitting(false);
      }
    },
    [signIn, setActiveSignIn, mfaCode, mfaSubmitting, t, redirectOrConflict],
  );

  useEffect(() => {
    if (!clerk.loaded || !signIn || !signUp) return;

    // Sjekk om MFA allerede er nødvendig (f.eks. etter refresh på callback-siden,
    // eller Clerk har allerede prosessert SSO). Må sjekkes uavhengig av handledRef
    // fordi secondFactorUrl peker tilbake hit, og da kjører useEffect på nytt.
    if (signIn.status === "needs_second_factor") {
      setNeedsMfa(true);
      return;
    }

    if (handledRef.current) return;
    handledRef.current = true;

    const setActive = mode === "sign-in" ? setActiveSignIn : setActiveSignUp;
    if (!setActive) return;

    const handleCallback = async () => {

      try {
        // Sett secondFactorUrl til current page URL slik at Clerk ikke navigerer bort ved MFA
        const currentUrl = window.location.href;
        const callbackOpts = mode === "sign-in"
          ? {
              signInForceRedirectUrl: redirectUrl,
              signUpForceRedirectUrl: redirectUrl,
              signInUrl: signInHref,
              signUpUrl: signUpHref,
              continueSignUpUrl: continueSignUpHref,
              firstFactorUrl: signInHref,
              secondFactorUrl: currentUrl,
            }
          : {
              signUpForceRedirectUrl: continueSignUpHref,
              signInForceRedirectUrl: redirectUrl,
              signUpUrl: signUpHref,
              signInUrl: signInHref,
              continueSignUpUrl: continueSignUpHref,
              firstFactorUrl: signInHref,
              secondFactorUrl: currentUrl,
            };

        const callbackResult = await Promise.race([
          clerk.handleRedirectCallback(callbackOpts),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), SSO_CALLBACK_TIMEOUT_MS),
          ),
        ]);
        if (callbackResult === "timeout") throw new Error("SSO callback timeout");

        // handleRedirectCallback fullført — sjekk om MFA ble nødvendig
        if (signIn.status === "needs_second_factor") {
          setNeedsMfa(true);
          return;
        }
      } catch {
        // handleRedirectCallback feilet — sjekk transfer-cases og MFA
        if (mode === "sign-in") {
          // Sjekk om MFA er nødvendig
          if (signIn.status === "needs_second_factor") {
            setNeedsMfa(true);
            return;
          }

          // Sign-in: sjekk begge retninger
          const signUpExternalStatus = signUp.verifications?.externalAccount?.status;
          const signInExternalStatus = signIn.firstFactorVerification?.status;

          if (signUpExternalStatus === "transferable") {
            try {
              const result = await signIn.create({ transfer: true });
              if (result.status === "needs_second_factor") {
                setNeedsMfa(true);
                return;
              }
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
              if (result.status === "needs_second_factor") {
                setNeedsMfa(true);
                return;
              }
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

        // Siste sjekk: MFA kan ha blitt nødvendig under transfer
        if (signIn.status === "needs_second_factor") {
          setNeedsMfa(true);
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
  }, [clerk, signIn, signUp, setActiveSignIn, setActiveSignUp, redirectUrl, signInHref, signUpHref, continueSignUpHref, mode, t, redirectOrConflict]);

  return {
    callbackError,
    oauthConflict,
    redirectUrl,
    signInHref,
    signUpHref,
    needsMfa,
    mfaCode,
    setMfaCode,
    mfaError,
    mfaSubmitting,
    handleMfa,
  };
}

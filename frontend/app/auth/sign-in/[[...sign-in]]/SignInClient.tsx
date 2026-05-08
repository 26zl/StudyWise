"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSignIn } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
import { useLanguage } from "@/app/i18n";
import { LoadingView } from "@/app/components/ui/Loading";
import {
  parseClerkError,
  classifyClerkSignInError,
  withAuthTimeout,
  AuthTimeoutError,
  AuthCard,
  AuthHeader,
  AuthOAuthButtons,
  AuthDivider,
  AuthError,
  AuthPrimaryButton,
  AuthFooterLink,
  SecuredByClerk,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";
import { detectSecondFactorStrategy } from "@/app/auth/mfaStrategy";

type SignInClientProps = {
  initialVerified: boolean;
};

const MFA_TIMEOUT_MS = 15_000;

export function SignInClient({ initialVerified }: SignInClientProps) {
  const { t } = useLanguage();
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn, setActive } = useSignIn();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const isRedirectingToDashboard = isLoaded && isSignedIn;

  // Vis feilmelding fra URL-parameter (f.eks. etter auth-konflikt redirect)
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const redirectUrl = getPostAuthRedirectFromParams(searchParams);
  const signUpHref = withPostAuthRedirect("/auth/sign-up", redirectUrl);
  const forgotPasswordHref = withPostAuthRedirect("/auth/forgot-password", redirectUrl);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(urlError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);

  // Scrub ?error= fra URL etter at feilen er overført til state.
  // Forhindrer at kontostatus/feilmelding lekker til browser-historikk,
  // screenshots og eventuell klientside-telemetri (Datadog, PostHog).
  useEffect(() => {
    if (!urlError || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("error")) return;
    params.delete("error");
    const nyQuery = params.toString();
    const nyUrl = `${window.location.pathname}${nyQuery ? `?${nyQuery}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nyUrl);
  }, [urlError]);

  // MFA — aktiveres når Clerk returnerer needs_second_factor
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const redirectEtterAuth = useCallback(() => {
    window.location.replace(redirectUrl);
  }, [redirectUrl]);

  const getSignInErrorMessage = useCallback(
    (err: unknown) => {
      switch (classifyClerkSignInError(err)) {
        case "credentials":
          return t("auth.signIn.errors.credentials");
        case "method":
          return t("auth.signIn.errors.method");
        case "rateLimited":
          return t("auth.signIn.errors.rateLimited");
        case "verificationRequired":
          return t("auth.signIn.errors.verificationRequired");
        default:
          return parseClerkError(err, t("auth.genericError"));
      }
    },
    [t],
  );

  // Safety net: hvis Clerk har markert sesjonen som aktiv, men den inline redirecten
  // etter handleSubmit/handleMfa aldri fullførte (f.eks. hengende setActive-promise),
  // tvinger vi en redirect her slik at LoadingView ikke blir stående evig.
  useEffect(() => {
    if (isRedirectingToDashboard) {
      redirectEtterAuth();
    }
  }, [isRedirectingToDashboard, redirectEtterAuth]);

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
          redirectEtterAuth();
        } else if (result.status === "needs_second_factor") {
          setMfaStep(true);
          setFormError(null);
        } else if (result.status === "complete") {
          setFormError(t("auth.signIn.sessionFailed"));
        } else {
          setFormError(t("auth.signIn.incomplete"));
        }
      } catch (err) {
        setFormError(getSignInErrorMessage(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [signIn, setActive, identifier, password, isSubmitting, t, redirectEtterAuth, getSignInErrorMessage],
  );

  // MFA: verifiser TOTP- eller backup-kode
  const handleMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || mfaSubmitting) return;

      // Auto-detekter om input er TOTP (6 sifre) eller backup-kode (alfanumerisk).
      // Brukeren slipper å bytte modus før de taster — Clerk validerer formatet
      // selv og returnerer en tydelig feil hvis koden ikke matcher noen faktor.
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
          "mfa_attempt",
        );

        if (result.status === "complete" && result.createdSessionId) {
          try {
            await withAuthTimeout(
              setActive({ session: result.createdSessionId }),
              MFA_TIMEOUT_MS,
              "mfa_setactive",
            );
          } catch {
            // setActive kan henge selv om sesjonen er opprettet server-side;
            // fallback-useEffecten over plukker uansett opp isSignedIn-overgangen.
          }
          redirectEtterAuth();
        } else {
          setMfaError(t("auth.signIn.mfa.verificationFailed"));
        }
      } catch (err) {
        // Recovery: hvis signIn allerede har en komplett sesjon (f.eks. attempten
        // lyktes server-side men klient-promisen hang), fullfør redirect likevel.
        if (signIn.status === "complete" && signIn.createdSessionId) {
          try {
            await withAuthTimeout(
              setActive({ session: signIn.createdSessionId }),
              MFA_TIMEOUT_MS,
              "mfa_recover_setactive",
            );
          } catch {
            // Falle gjennom — useEffect-safety-net håndterer det
          }
          redirectEtterAuth();
          return;
        }
        if (err instanceof AuthTimeoutError) {
          setMfaError(t("errors.generic.timeout"));
        } else {
          setMfaError(parseClerkError(err, t("auth.signIn.mfa.verificationFailed")));
        }
      } finally {
        setMfaSubmitting(false);
      }
    },
    [signIn, setActive, mfaCode, mfaSubmitting, t, redirectEtterAuth],
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
          redirectUrl: withPostAuthRedirect("/auth/sign-in/sso-callback", redirectUrl),
          redirectUrlComplete: redirectUrl,
        });
      } catch (err) {
        setFormError(getSignInErrorMessage(err));
        setIsOAuthSubmitting(false);
      }
    },
    [signIn, isOAuthSubmitting, t, redirectUrl, getSignInErrorMessage],
  );

  // Vent på Clerk før vi viser noe — hindrer at Turnstile og Clerks redirect-overlay vises samtidig
  if (!isLoaded) {
    return (
      <div className="w-full max-w-md">
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.generic"
          />
        </AuthCard>
      </div>
    );
  }

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirecting"
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
                // Ingen `inputMode="numeric"` eller `maxLength={6}` her: feltet
                // aksepterer både TOTP (6 sifre) og backup-koder (10 alfanumeriske).
                // Strategien velges av detectSecondFactorStrategy ved submit.
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
              href={signUpHref}
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
              href={forgotPasswordHref}
              prefetch={false}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
            >
              {t("auth.signIn.forgotPasswordAction")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </AuthCard>

          <SecuredByClerk label={t("auth.securedByClerk")} />
        </>
      )}
    </div>
  );
}

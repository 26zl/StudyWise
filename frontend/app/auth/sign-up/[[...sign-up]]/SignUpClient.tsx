"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSignUp } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
import { useLanguage } from "@/app/i18n";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import {
  isValidUsernameFormat,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from "common/auth";
import {
  parseClerkError,
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

type SignUpClientProps = {
  initialVerified: boolean;
};

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type SignUpStep = "form" | "verify";

function normalizeEmailForUsernameCheck(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@") || trimmed.includes(" ")) {
    return undefined;
  }
  return trimmed;
}

function buildUsernameCheckUrl(username: string, email?: string): string {
  const params = new URLSearchParams({ username });
  if (email) {
    params.set("email", email);
  }
  return `/api/user/username/check?${params.toString()}`;
}

export function SignUpClient({ initialVerified }: SignUpClientProps) {
  const { t } = useLanguage();
  const { isLoaded, isSignedIn } = useAuth();
  const { signUp, setActive } = useSignUp();
  const searchParams = useSearchParams();
  const redirectUrl = getPostAuthRedirectFromParams(searchParams);
  const signInHref = withPostAuthRedirect("/auth/sign-in", redirectUrl);
  const oauthCompleteHref = withPostAuthRedirect("/auth/sign-up?oauth=complete", redirectUrl);
  const [isVerified, setIsVerified] = useState(initialVerified);

  // Detekter post-OAuth retur — sjekk searchParams OG window.location for å unngå
  // flash av Turnstile-gate under SSR-hydrering (searchParams kan være tom under Suspense)
  const isOAuthReturn =
    searchParams.get("oauth") === "complete" ||
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("oauth") === "complete");
  const isRedirectingToDashboard = isLoaded && isSignedIn && !isOAuthReturn;

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const urlError = searchParams.get("error");
  const [formError, setFormError] = useState<string | null>(urlError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);

  // Passordkrav
  const passwordMinLengthOk = password.length >= 8;
  const passwordValid = passwordMinLengthOk;
  const passwordTouched = password.length > 0;

  // Username validation state
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameAbortRef = useRef<AbortController | null>(null);

  // Email verification state
  const [step, setStep] = useState<SignUpStep>("form");
  const [verificationCode, setVerificationCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");

  const redirectEtterAuth = useCallback(() => {
    window.location.replace(redirectUrl);
  }, [redirectUrl]);

  // Etter OAuth-retur: brukernavn er valgfritt, redirect direkte til dashboard.
  // Backend håndterer relink i findOrCreateUserByClerkId via /api/user/me.
  useEffect(() => {
    if (!isOAuthReturn || !isSignedIn) return;
    redirectEtterAuth();
  }, [isOAuthReturn, isSignedIn, redirectEtterAuth]);

  // Gjenopprett session hvis sign-up allerede er fullført (f.eks. etter reload på verify-steget)
  useEffect(() => {
    if (step !== "verify" || !signUp) return;
    if (signUp.status === "complete" && signUp.createdSessionId) {
      void setActive({ session: signUp.createdSessionId }).then(() => {
        redirectEtterAuth();
      });
    }
  }, [step, signUp, setActive, redirectEtterAuth]);

  // Debounced username check med AbortController (kun når brukernavn er oppgitt)
  useEffect(() => {
    if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);
    usernameAbortRef.current?.abort();

    const trimmed = username.trim();

    if (!trimmed || trimmed.length < USERNAME_MIN_LENGTH) {
      setUsernameStatus("idle");
      return;
    }
    if (!isValidUsernameFormat(trimmed)) {
      setUsernameStatus("invalid");
      return;
    }

    usernameDebounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      usernameAbortRef.current = controller;
      setUsernameStatus("checking");

      fetch(buildUsernameCheckUrl(trimmed, normalizeEmailForUsernameCheck(email)), { signal: controller.signal })
        .then(async (res) => {
          if (controller.signal.aborted) return;
          if (!res.ok) {
            setUsernameStatus("idle");
            return;
          }
          const data = await res.json();
          if (controller.signal.aborted) return;
          setUsernameStatus(data.available ? "available" : "taken");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setUsernameStatus("idle");
          }
        });
    }, 400);

    return () => {
      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);
      usernameAbortRef.current?.abort();
    };
  }, [username, email]);

  // Email+password sign-up
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signUp || isSubmitting) return;

      const trimmedFirstName = firstName.trim();
      const trimmedLastName = lastName.trim();
      const trimmedUsername = username.trim();
      const trimmedEmail = email.trim();

      if (!trimmedFirstName || !trimmedLastName) {
        setFormError(t("auth.signUp.allFieldsRequired"));
        return;
      }
      // Brukernavn er valgfritt — valider kun hvis oppgitt
      if (trimmedUsername && !isValidUsernameFormat(trimmedUsername)) {
        setFormError(t("auth.signUp.usernameInvalid"));
        return;
      }
      if (trimmedUsername && usernameStatus === "checking") {
        setFormError(t("auth.signUp.usernameWait"));
        return;
      }
      if (!trimmedEmail || !password) {
        setFormError(t("auth.signUp.allFieldsRequired"));
        return;
      }
      if (!passwordValid) {
        setFormError(t("auth.signUp.passwordRequirements.weak"));
        return;
      }

      setIsSubmitting(true);
      setFormError(null);

      try {
        // Server-side Turnstile-gate
        const gateOk = await checkAuthTurnstileGate();
        if (!gateOk) {
          setFormError(t("auth.humanCheck.gateError"));
          setIsSubmitting(false);
          return;
        }

        // Sjekk brukernavn-tilgjengelighet kun hvis oppgitt
        if (trimmedUsername) {
          const checkRes = await fetch(
            buildUsernameCheckUrl(
              trimmedUsername,
              normalizeEmailForUsernameCheck(trimmedEmail),
            ),
          );
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (!checkData.available) {
              setUsernameStatus("taken");
              setFormError(t("auth.signUp.usernameTaken"));
              setIsSubmitting(false);
              return;
            }
          }
        }

        await signUp.create({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          ...(trimmedUsername ? { username: trimmedUsername } : {}),
          emailAddress: trimmedEmail,
          password,
        });

        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });

        setPendingEmail(trimmedEmail);
        setStep("verify");
      } catch (err) {
        setFormError(
          parseClerkError(err, t("auth.genericError"), (code) => {
            switch (code) {
              case "form_password_pwned":
                return t("auth.signUp.passwordErrors.pwned");
              case "form_password_not_strong_enough":
                return t("auth.signUp.passwordErrors.notStrongEnough");
              case "form_password_length_too_short":
                return t("auth.signUp.passwordErrors.tooShort");
              default:
                return undefined;
            }
          }),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [signUp, firstName, lastName, username, email, password, passwordValid, usernameStatus, isSubmitting, t],
  );

  // OAuth sign-up (Google/Microsoft)
  const handleOAuth = useCallback(
    async (strategy: "oauth_google" | "oauth_microsoft") => {
      if (!signUp || isOAuthSubmitting) return;
      setFormError(null);
      setIsOAuthSubmitting(true);

      try {
        const gateOk = await checkAuthTurnstileGate();
        if (!gateOk) {
          setFormError(t("auth.humanCheck.gateError"));
          setIsOAuthSubmitting(false);
          return;
        }

        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: withPostAuthRedirect("/auth/sign-up/sso-callback", redirectUrl),
          redirectUrlComplete: oauthCompleteHref,
        });
      } catch (err) {
        setFormError(parseClerkError(err, t("auth.genericError")));
        setIsOAuthSubmitting(false);
      }
    },
    [signUp, isOAuthSubmitting, t, redirectUrl, oauthCompleteHref],
  );

  // Verifiser e-postkode
  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signUp || isVerifyingCode) return;

      setIsVerifyingCode(true);
      setVerifyError(null);

      try {
        const result = await signUp.attemptEmailAddressVerification({
          code: verificationCode,
        });

        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          redirectEtterAuth();
        } else if (result.status === "complete") {
          setVerifyError(t("auth.signUp.verify.sessionFailed"));
        } else {
          setVerifyError(t("auth.signUp.verify.incomplete"));
        }
      } catch (err) {
        // Gjenopprett hvis sign-up allerede er ferdig
        if (signUp.status === "complete" && signUp.createdSessionId) {
          try {
            await setActive({ session: signUp.createdSessionId });
            redirectEtterAuth();
            return;
          } catch {
            // Fall through til feilmelding
          }
        }

        setVerifyError(parseClerkError(err, t("auth.genericError")));
      } finally {
        setIsVerifyingCode(false);
      }
    },
    [signUp, setActive, verificationCode, isVerifyingCode, t, redirectEtterAuth],
  );

  // Send verifiseringskode på nytt
  const handleResend = useCallback(async () => {
    if (!signUp) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      showToast.success(
        t("auth.signUp.verify.codeSentTitle"),
        t("auth.signUp.verify.codeSentDescription"),
      );
    } catch (err) {
      showToast.error(
        t("auth.signUp.verify.codeSendFailedTitle"),
        parseClerkError(err, t("auth.genericError")),
      );
    }
  }, [signUp, t]);

  // Redirect til dashboard hvis allerede innlogget, eller vis loading ved OAuth-retur
  if (isRedirectingToDashboard || isOAuthReturn) {
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

  const usernameIndicator = () => {
    switch (usernameStatus) {
      case "checking":
        return (
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("auth.signUp.usernameChecking")}
          </span>
        );
      case "available":
        return (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t("auth.signUp.usernameAvailable")}
          </span>
        );
      case "taken":
        return (
          <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3" />
            {t("auth.signUp.usernameTaken")}
          </span>
        );
      case "invalid":
        return (
          <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3" />
            {t("auth.signUp.usernameInvalid")}
          </span>
        );
      default:
        return (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t("auth.signUp.usernameHint")}
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-md space-y-4">
      <AuthTurnstileInline
        initialVerified={initialVerified}
        onVerified={() => setIsVerified(true)}
      />

      {/* Registreringsskjema */}
      {isVerified && step === "form" && (
        <AuthCard>
          <AuthHeader
            title={t("auth.signUp.title")}
            subtitle={t("auth.signUp.subtitle")}
          />

          <AuthOAuthButtons
            onGoogle={() => void handleOAuth("oauth_google")}
            onMicrosoft={() => void handleOAuth("oauth_microsoft")}
            disabled={isSubmitting || isOAuthSubmitting}
          />

          <AuthDivider text={t("auth.signUp.orContinueWith")} />

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="signup-firstname" className={AUTH_LABEL_CLASSES}>
                  {t("auth.signUp.firstNameLabel")}
                </label>
                <input
                  id="signup-firstname"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t("auth.signUp.firstNamePlaceholder")}
                  className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  autoComplete="given-name"
                  autoFocus
                  disabled={isSubmitting || isOAuthSubmitting}
                />
              </div>
              <div>
                <label htmlFor="signup-lastname" className={AUTH_LABEL_CLASSES}>
                  {t("auth.signUp.lastNameLabel")}
                </label>
                <input
                  id="signup-lastname"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t("auth.signUp.lastNamePlaceholder")}
                  className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                  autoComplete="family-name"
                  disabled={isSubmitting || isOAuthSubmitting}
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-username" className={AUTH_LABEL_CLASSES}>
                {t("auth.signUp.usernameLabel")}
                <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">
                  ({t("common.labels.optional")})
                </span>
              </label>
              <input
                id="signup-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.signUp.usernamePlaceholder")}
                className={`mt-1 ${AUTH_INPUT_CLASSES} ${
                  usernameStatus === "taken" || usernameStatus === "invalid"
                    ? "border-red-300 dark:border-red-700"
                    : usernameStatus === "available"
                      ? "border-emerald-300 dark:border-emerald-700"
                      : ""
                }`}
                autoComplete="username"
                disabled={isSubmitting || isOAuthSubmitting}
                minLength={USERNAME_MIN_LENGTH}
                maxLength={USERNAME_MAX_LENGTH}
              />
              <div className="mt-1">{usernameIndicator()}</div>
            </div>

            <div>
              <label htmlFor="signup-email" className={AUTH_LABEL_CLASSES}>
                {t("auth.signUp.emailLabel")}
              </label>
              <input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.signUp.emailPlaceholder")}
                className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                autoComplete="email"
                disabled={isSubmitting || isOAuthSubmitting}
              />
            </div>

            <div>
              <label htmlFor="signup-password" className={AUTH_LABEL_CLASSES}>
                {t("auth.signUp.passwordLabel")}
              </label>
              <input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.signUp.passwordPlaceholder")}
                className={`mt-1 ${AUTH_INPUT_CLASSES} ${
                  passwordTouched && !passwordValid
                    ? "border-red-300 dark:border-red-700"
                    : passwordTouched && passwordValid
                      ? "border-emerald-300 dark:border-emerald-700"
                      : ""
                }`}
                autoComplete="new-password"
                disabled={isSubmitting || isOAuthSubmitting}
              />
              {passwordTouched && (
                <ul className="mt-2 space-y-1">
                  <li
                    className={`flex items-center gap-1.5 text-xs ${
                      passwordMinLengthOk
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {passwordMinLengthOk ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 shrink-0" />
                    )}
                    <span>{t("auth.signUp.passwordRequirements.minLength")}</span>
                  </li>
                  <li className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>{t("auth.signUp.passwordRequirements.hint")}</span>
                  </li>
                </ul>
              )}
            </div>

            <AuthError message={formError} />

            <AuthPrimaryButton
              isLoading={isSubmitting}
              loadingText={t("auth.signUp.submitting")}
              disabled={
                usernameStatus === "taken" ||
                usernameStatus === "invalid" ||
                usernameStatus === "checking" ||
                !passwordValid
              }
            >
              {t("auth.signUp.submitButton")}
            </AuthPrimaryButton>
          </form>

          <AuthFooterLink
            text={t("auth.signUp.alreadyHaveAccount")}
            linkText={t("auth.signUp.signInLink")}
            href={signInHref}
          />

          {/* Clerk bot-registreringsbeskyttelse */}
          <div id="clerk-captcha" />
        </AuthCard>
      )}

      {/* E-postverifisering */}
      {isVerified && step === "verify" && (
        <AuthCard>
          <AuthHeader
            title={t("auth.signUp.verify.title")}
            subtitle={t("auth.signUp.verify.description", { email: pendingEmail })}
          />

          <form onSubmit={handleVerify} className="space-y-4" noValidate>
            <div>
              <label htmlFor="verify-code" className={AUTH_LABEL_CLASSES}>
                {t("auth.signUp.verify.codeLabel")}
              </label>
              <input
                id="verify-code"
                type="text"
                inputMode="numeric"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder={t("auth.signUp.verify.codePlaceholder")}
                className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                autoFocus
                autoComplete="one-time-code"
                disabled={isVerifyingCode}
              />
            </div>

            <AuthError message={verifyError} />

            <AuthPrimaryButton
              isLoading={isVerifyingCode}
              loadingText={t("auth.signUp.verify.submitting")}
              disabled={!verificationCode.trim()}
            >
              {t("auth.signUp.verify.submitButton")}
            </AuthPrimaryButton>

            <button
              type="button"
              onClick={() => void handleResend()}
              className="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {t("auth.signUp.verify.resend")}
            </button>
          </form>

          {verifyError === t("auth.signUp.verify.alreadyVerified") && (
            <div className="mt-4 text-center">
              <Link
                href={signInHref}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t("auth.signIn.submitButton")} &rarr;
              </Link>
            </div>
          )}
        </AuthCard>
      )}

      <SecuredByClerk label={t("auth.securedByClerk")} />
    </div>
  );
}

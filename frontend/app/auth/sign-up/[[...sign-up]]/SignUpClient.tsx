"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useSignUp } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { useLanguage } from "@/app/i18n";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { fetchApi } from "@/app/lib/apiClient";
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
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";

type SignUpClientProps = {
  initialVerified: boolean;
};

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type SignUpStep = "form" | "verify" | "oauth-username";

export function SignUpClient({ initialVerified }: SignUpClientProps) {
  const { t } = useLanguage();
  const { isLoaded, isSignedIn } = useAuth();
  const { user: clerkUser } = useUser();
  const { signUp, setActive } = useSignUp();
  const searchParams = useSearchParams();
  const [isVerified, setIsVerified] = useState(initialVerified);

  // Detekter post-OAuth retur: bruker er innlogget og kommer tilbake fra OAuth
  const isOAuthReturn = searchParams.get("oauth") === "complete";
  // OAuth sign-up kan være ufullstendig (mangler brukernavn) — da er isSignedIn false
  const isOAuthMissingRequirements =
    isOAuthReturn && signUp?.status === "missing_requirements";
  const isRedirectingToDashboard = isLoaded && isSignedIn && !isOAuthReturn;

  // Sjekk om OAuth-provider ga fornavn/etternavn
  const oauthMissingFirstName = isOAuthReturn && !signUp?.firstName;
  const oauthMissingLastName = isOAuthReturn && !signUp?.lastName;

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);

  // Username validation state
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameAbortRef = useRef<AbortController | null>(null);

  // Email verification state
  const [step, setStep] = useState<SignUpStep>(
    (isOAuthReturn && isSignedIn) || isOAuthMissingRequirements
      ? "oauth-username"
      : "form",
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");

  // Sett steg til oauth-username når bruker kommer tilbake fra OAuth
  useEffect(() => {
    if (!isOAuthReturn || step === "oauth-username") return;

    // Case 1: Sign-up fullført, session aktiv — sjekk om brukernavn mangler
    if (isSignedIn) {
      if (clerkUser?.username) {
        window.location.replace("/dashboard");
      } else {
        setStep("oauth-username");
      }
      return;
    }

    // Case 2: Sign-up ufullstendig (OAuth OK men mangler brukernavn)
    if (isOAuthMissingRequirements) {
      setStep("oauth-username");
    }
  }, [isOAuthReturn, isSignedIn, isOAuthMissingRequirements, clerkUser, step]);

  // Gjenopprett session hvis sign-up allerede er fullført (f.eks. etter reload på verify-steget)
  useEffect(() => {
    if (step !== "verify" || !signUp) return;
    if (signUp.status === "complete" && signUp.createdSessionId) {
      void setActive({ session: signUp.createdSessionId }).then(() => {
        window.location.replace("/dashboard");
      });
    }
  }, [step, signUp, setActive]);

  // Debounced username check med AbortController
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

      fetch(
        `/api/user/username/check?username=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
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
  }, [username]);

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
      if (!isValidUsernameFormat(trimmedUsername)) {
        setFormError(t("auth.signUp.usernameInvalid"));
        return;
      }
      if (usernameStatus === "taken") {
        setFormError(t("auth.signUp.usernameTaken"));
        return;
      }
      if (usernameStatus === "checking") {
        setFormError(t("auth.signUp.usernameWait"));
        return;
      }
      if (!trimmedEmail || !password) {
        setFormError(t("auth.signUp.allFieldsRequired"));
        return;
      }

      setIsSubmitting(true);
      setFormError(null);

      try {
        const checkRes = await fetch(
          `/api/user/username/check?username=${encodeURIComponent(trimmedUsername)}`,
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

        await signUp.create({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          username: trimmedUsername,
          emailAddress: trimmedEmail,
          password,
        });

        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });

        setPendingEmail(trimmedEmail);
        setStep("verify");
      } catch (err) {
        setFormError(parseClerkError(err, t("auth.genericError")));
      } finally {
        setIsSubmitting(false);
      }
    },
    [signUp, firstName, lastName, username, email, password, usernameStatus, isSubmitting, t],
  );

  // OAuth sign-up (Google/Microsoft) — uten brukernavn, velges etterpå
  const handleOAuth = useCallback(
    async (strategy: "oauth_google" | "oauth_microsoft") => {
      if (!signUp || isOAuthSubmitting) return;
      setFormError(null);
      setIsOAuthSubmitting(true);

      try {
        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: "/auth/sign-up/sso-callback",
          redirectUrlComplete: "/auth/sign-up?oauth=complete",
        });
      } catch (err) {
        setFormError(parseClerkError(err, t("auth.genericError")));
        setIsOAuthSubmitting(false);
      }
    },
    [signUp, isOAuthSubmitting, t],
  );

  // Sett brukernavn etter OAuth
  const handleSetOAuthUsername = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedUsername = username.trim();

      if (!isValidUsernameFormat(trimmedUsername)) {
        setFormError(t("auth.signUp.usernameInvalid"));
        return;
      }
      if (usernameStatus === "taken") {
        setFormError(t("auth.signUp.usernameTaken"));
        return;
      }
      if (usernameStatus === "checking") {
        setFormError(t("auth.signUp.usernameWait"));
        return;
      }

      // Valider navn hvis de mangler fra OAuth-provider
      const trimmedFirstName = firstName.trim();
      const trimmedLastName = lastName.trim();
      if (oauthMissingFirstName && !trimmedFirstName) {
        setFormError(t("auth.signUp.allFieldsRequired"));
        return;
      }
      if (oauthMissingLastName && !trimmedLastName) {
        setFormError(t("auth.signUp.allFieldsRequired"));
        return;
      }

      setIsSubmitting(true);
      setFormError(null);

      try {
        // Case 1: Sign-up er ufullstendig (mangler brukernavn) — sett via Clerk sign-up
        if (signUp && signUp.status === "missing_requirements") {
          const updateFields: Record<string, string> = { username: trimmedUsername };
          if (oauthMissingFirstName && trimmedFirstName) {
            updateFields.firstName = trimmedFirstName;
          }
          if (oauthMissingLastName && trimmedLastName) {
            updateFields.lastName = trimmedLastName;
          }
          const result = await signUp.update(updateFields);

          if (result.status === "complete" && result.createdSessionId) {
            await setActive({ session: result.createdSessionId });
            window.location.replace("/dashboard");
            return;
          }

          // Fortsatt ufullstendig etter oppdatering
          setFormError(t("auth.signUp.oauthUsernameError"));
          return;
        }

        // Case 2: Bruker er allerede innlogget — oppdater brukernavn via API
        const res = await fetchApi("/api/user/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmedUsername }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.error === "username_conflict") {
            setUsernameStatus("taken");
            setFormError(t("auth.signUp.usernameTaken"));
          } else {
            setFormError(data?.melding ?? t("auth.signUp.oauthUsernameError"));
          }
          return;
        }

        window.location.replace("/dashboard");
      } catch (err) {
        const msg = parseClerkError(err, t("auth.signUp.oauthUsernameError"));
        // Clerk returnerer spesifikk feil hvis brukernavn er tatt
        if (typeof msg === "string" && msg.toLowerCase().includes("username")) {
          setUsernameStatus("taken");
        }
        setFormError(msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [signUp, setActive, username, firstName, lastName, oauthMissingFirstName, oauthMissingLastName, usernameStatus, t],
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
          window.location.replace("/dashboard");
        } else if (result.status === "complete") {
          setVerifyError(t("auth.signUp.verify.sessionFailed"));
        } else {
          setVerifyError(t("auth.signUp.verify.incomplete"));
        }
      } catch (err) {
        // Gjenopprett hvis sign-up allerede er ferdig (e.g. re-klikk etter suksess)
        if (signUp.status === "complete" && signUp.createdSessionId) {
          try {
            await setActive({ session: signUp.createdSessionId });
            window.location.replace("/dashboard");
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
    [signUp, setActive, verificationCode, isVerifyingCode, t],
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

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirectingToDashboard"
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

  const usernameField = (id: string) => (
    <div>
      <label htmlFor={id} className={AUTH_LABEL_CLASSES}>
        {t("auth.signUp.usernameLabel")}
      </label>
      <input
        id={id}
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
        disabled={isSubmitting}
        minLength={USERNAME_MIN_LENGTH}
        maxLength={USERNAME_MAX_LENGTH}
      />
      <div className="mt-1">{usernameIndicator()}</div>
    </div>
  );

  return (
    <div className="w-full max-w-md space-y-4">
      <AuthTurnstileInline
        initialVerified={initialVerified}
        onVerified={() => setIsVerified(true)}
      />

      {/* Post-OAuth: velg brukernavn (og evt. navn hvis OAuth-provider ikke ga det) */}
      {isVerified && step === "oauth-username" && (
        <AuthCard>
          <AuthHeader
            title={t("auth.signUp.oauthUsername.title")}
            subtitle={t("auth.signUp.oauthUsername.subtitle")}
          />

          <form onSubmit={handleSetOAuthUsername} className="space-y-4" noValidate>
            {/* Vis navnefelt kun hvis OAuth-provider ikke ga fornavn/etternavn */}
            {(oauthMissingFirstName || oauthMissingLastName) && (
              <div className="grid grid-cols-2 gap-3">
                {oauthMissingFirstName && (
                  <div>
                    <label htmlFor="oauth-firstname" className={AUTH_LABEL_CLASSES}>
                      {t("auth.signUp.firstNameLabel")}
                    </label>
                    <input
                      id="oauth-firstname"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={t("auth.signUp.firstNamePlaceholder")}
                      className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                      autoComplete="given-name"
                      autoFocus
                      disabled={isSubmitting}
                    />
                  </div>
                )}
                {oauthMissingLastName && (
                  <div>
                    <label htmlFor="oauth-lastname" className={AUTH_LABEL_CLASSES}>
                      {t("auth.signUp.lastNameLabel")}
                    </label>
                    <input
                      id="oauth-lastname"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={t("auth.signUp.lastNamePlaceholder")}
                      className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                      autoComplete="family-name"
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
            )}

            {usernameField("oauth-username")}

            <AuthError message={formError} />

            <AuthPrimaryButton
              isLoading={isSubmitting}
              loadingText={t("auth.signUp.oauthUsername.submitting")}
              disabled={
                usernameStatus === "taken" ||
                usernameStatus === "invalid" ||
                usernameStatus === "checking"
              }
            >
              {t("auth.signUp.oauthUsername.submitButton")}
            </AuthPrimaryButton>
          </form>
        </AuthCard>
      )}

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

            {usernameField("signup-username")}

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
                className={`mt-1 ${AUTH_INPUT_CLASSES}`}
                autoComplete="new-password"
                disabled={isSubmitting || isOAuthSubmitting}
              />
            </div>

            <AuthError message={formError} />

            <AuthPrimaryButton
              isLoading={isSubmitting}
              loadingText={t("auth.signUp.submitting")}
              disabled={
                usernameStatus === "taken" ||
                usernameStatus === "invalid" ||
                usernameStatus === "checking"
              }
            >
              {t("auth.signUp.submitButton")}
            </AuthPrimaryButton>
          </form>

          <AuthFooterLink
            text={t("auth.signUp.alreadyHaveAccount")}
            linkText={t("auth.signUp.signInLink")}
            href="/auth/sign-in"
          />

          {/* Påkrevd for Clerks bot-registreringsbeskyttelse */}
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
                href="/auth/sign-in"
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t("auth.signIn.submitButton")} &rarr;
              </Link>
            </div>
          )}
        </AuthCard>
      )}
    </div>
  );
}

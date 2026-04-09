"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useSignUp } from "@clerk/nextjs/legacy";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { checkAuthTurnstileGate } from "@/app/auth/auth-turnstile-api";
import { getPostAuthRedirectFromParams, withPostAuthRedirect } from "@/app/auth/redirects";
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
  SecuredByClerk,
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/app/auth/authUI";

type SignUpClientProps = {
  initialVerified: boolean;
};

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type SignUpStep = "form" | "verify" | "oauth-username";

function normalizeEmailForUsernameCheck(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@") || trimmed.includes(" ")) {
    return undefined;
  }
  return trimmed;
}

function readPendingSignUpEmail(signUp: unknown): string | undefined {
  if (!signUp || typeof signUp !== "object") {
    return undefined;
  }

  const candidate = signUp as Record<string, unknown>;
  if (typeof candidate.emailAddress === "string") {
    return normalizeEmailForUsernameCheck(candidate.emailAddress);
  }

  if (Array.isArray(candidate.emailAddresses)) {
    for (const item of candidate.emailAddresses) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.emailAddress === "string") {
        return normalizeEmailForUsernameCheck(entry.emailAddress);
      }
    }
  }

  return undefined;
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
  const clerk = useClerk();
  const { isLoaded: userLoaded, user: clerkUser } = useUser();
  const { signUp, setActive } = useSignUp();
  const searchParams = useSearchParams();
  const redirectUrl = getPostAuthRedirectFromParams(searchParams);
  const signInHref = withPostAuthRedirect("/auth/sign-in", redirectUrl);
  const oauthCompleteHref = withPostAuthRedirect("/auth/sign-up?oauth=complete", redirectUrl);
  const [isVerified, setIsVerified] = useState(initialVerified);

  // Detekter post-OAuth retur: bruker er innlogget og kommer tilbake fra OAuth
  const isOAuthReturn = searchParams.get("oauth") === "complete";
  // OAuth sign-up kan være ufullstendig (mangler brukernavn) — da er isSignedIn false
  const isOAuthMissingRequirements =
    isOAuthReturn && signUp?.status === "missing_requirements";
  const isRedirectingToDashboard = isLoaded && isSignedIn && !isOAuthReturn;

  // Sjekk om OAuth-provider ga fornavn/etternavn (vent til Clerk er lastet)
  const oauthMissingFirstName = isOAuthReturn && isLoaded && userLoaded && !signUp?.firstName && !clerkUser?.firstName;
  const oauthMissingLastName = isOAuthReturn && isLoaded && userLoaded && !signUp?.lastName && !clerkUser?.lastName;

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Vis feilmelding fra URL-parameter (f.eks. etter auth-konflikt redirect)
  const urlError = searchParams.get("error");
  const [formError, setFormError] = useState<string | null>(urlError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);

  // Passordkrav — match Clerks instilling: min 8 tegn lokalt, styrke (zxcvbn
  // "Normal") og HaveIBeenPwned-sjekk kjøres av Clerk server-side ved submit.
  // Vi legger ingen lokale complexity-regler (stor/liten/tall/spesial) siden
  // Clerks "Password rules" er satt til None — det ville blokkert passord
  // Clerk faktisk aksepterer.
  const passwordMinLengthOk = password.length >= 8;
  const passwordValid = passwordMinLengthOk;
  const passwordTouched = password.length > 0;

  // Username validation state
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameAbortRef = useRef<AbortController | null>(null);

  // OAuth-konflikt: blokkerer registrering tidlig
  // Start som true ved OAuth-retur med aktiv sesjon for å unngå flash av skjemaet før conflict-sjekk kjører
  const [oauthConflict, setOauthConflict] = useState(false);
  const [oauthConflictChecking, setOauthConflictChecking] = useState(isOAuthReturn && isSignedIn);

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
  const usernameCheckEmail =
    step === "form"
      ? normalizeEmailForUsernameCheck(email)
      : readPendingSignUpEmail(signUp) ??
        normalizeEmailForUsernameCheck(
          clerkUser?.primaryEmailAddress?.emailAddress ??
            clerkUser?.emailAddresses?.[0]?.emailAddress,
        );

  const redirectEtterAuth = useCallback(() => {
    window.location.replace(redirectUrl);
  }, [redirectUrl]);

  // Sett steg til oauth-username når bruker kommer tilbake fra OAuth
  useEffect(() => {
    if (!isOAuthReturn || step === "oauth-username") return;

    // Case 1: Sign-up fullført, session aktiv — sjekk om brukernavn mangler
    if (isSignedIn) {
      if (clerkUser?.username) {
        redirectEtterAuth();
      } else {
        setStep("oauth-username");
      }
      return;
    }

    // Case 2: Sign-up ufullstendig (OAuth OK men mangler brukernavn)
    if (isOAuthMissingRequirements) {
      setStep("oauth-username");
    }
  }, [isOAuthReturn, isSignedIn, isOAuthMissingRequirements, clerkUser, step, redirectEtterAuth]);

  // Pre-check for OAuth-konto-konflikt: kall /api/user/me tidlig for å oppdage om
  // samme OAuth-konto allerede er tilknyttet en annen bruker (f.eks. dev vs. prod).
  // Vises som feilmelding istedenfor brukernavn-skjemaet.
  // Ved kryssmiljø re-link: hvis backend-brukeren allerede har brukernavn, synk til Clerk og gå videre.
  useEffect(() => {
    if (step !== "oauth-username" || !isSignedIn || oauthConflict) return;

    let cancelled = false;
    setOauthConflictChecking(true);

    fetchApi("/api/user/me", { method: "GET" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 409 || res.status === 403) {
          const json = await res.json().catch(() => ({}));
          const errorType = typeof json?.error === "string" ? json.error : undefined;
          const errorMessage = typeof json?.melding === "string"
            ? json.melding
            : t("auth.conflictRedirect.emailConflict");
          if (
            errorType === "oauth_account_conflict" ||
            errorType === "oauth_metadata_missing"
          ) {
            await clerk.signOut().catch(() => {});
            setOauthConflict(true);
            return;
          }
          if (
            errorType === "account_conflict" ||
            errorType === "username_conflict" ||
            errorType === "user_deleted" ||
            errorType === "user_locked"
          ) {
            await clerk.signOut().catch(() => {});
            window.location.replace(
              `${signInHref}?error=${encodeURIComponent(errorMessage)}`,
            );
            return;
          }
          // turnstile_required: redirect til dashboard — TurnstileReChallenge viser re-verifikasjon
          if (errorType === "turnstile_required") {
            redirectEtterAuth();
            return;
          }
        }

        // Re-link: backend-bruker har allerede brukernavn — synk til Clerk og hopp over prompt
        if (res.ok && clerkUser && !clerkUser.username) {
          const json = await res.json().catch(() => null);
          const existingUsername = json?.user?.username;
          if (existingUsername) {
            try {
              await clerkUser.update({ username: existingUsername });
            } catch {
              // Clerk-oppdatering feilet — brukeren kan fortsette manuelt
            }
            redirectEtterAuth();
            return;
          }
        }
      })
      .catch(() => {
        // Nettverksfeil — la brukeren fortsette normalt
      })
      .finally(() => {
        if (!cancelled) setOauthConflictChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step, isSignedIn, oauthConflict, clerkUser, redirectEtterAuth]);

  // Gjenopprett session hvis sign-up allerede er fullført (f.eks. etter reload på verify-steget)
  useEffect(() => {
    if (step !== "verify" || !signUp) return;
    if (signUp.status === "complete" && signUp.createdSessionId) {
      void setActive({ session: signUp.createdSessionId }).then(() => {
        redirectEtterAuth();
      });
    }
  }, [step, signUp, setActive, redirectEtterAuth]);

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

      fetch(buildUsernameCheckUrl(trimmed, usernameCheckEmail), { signal: controller.signal })
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
  }, [username, usernameCheckEmail]);

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
      if (usernameStatus === "checking") {
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
        // Server-side Turnstile-gate: verifiser at human-check er bestått før Clerk-kall
        const gateOk = await checkAuthTurnstileGate();
        if (!gateOk) {
          setFormError(t("auth.humanCheck.gateError"));
          setIsSubmitting(false);
          return;
        }

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

  // OAuth sign-up (Google/Microsoft) — uten brukernavn, velges etterpå
  const handleOAuth = useCallback(
    async (strategy: "oauth_google" | "oauth_microsoft") => {
      if (!signUp || isOAuthSubmitting) return;
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

  // Sett brukernavn etter OAuth
  const handleSetOAuthUsername = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedUsername = username.trim();

      if (!isValidUsernameFormat(trimmedUsername)) {
        setFormError(t("auth.signUp.usernameInvalid"));
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
        const checkRes = await fetch(buildUsernameCheckUrl(trimmedUsername, usernameCheckEmail));
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (!checkData.available) {
            setUsernameStatus("taken");
            setFormError(t("auth.signUp.usernameTaken"));
            return;
          }
        }

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
            redirectEtterAuth();
            return;
          }

          // Fortsatt ufullstendig etter oppdatering
          setFormError(t("auth.signUp.oauthUsernameError"));
          return;
        }

        // Case 2: Bruker er allerede innlogget — oppdater brukernavn via Clerk SDK
        if (!clerkUser) {
          setFormError(t("auth.signUp.oauthUsernameError"));
          return;
        }

        const updatePayload: Record<string, string> = { username: trimmedUsername };
        if (oauthMissingFirstName && trimmedFirstName) {
          updatePayload.firstName = trimmedFirstName;
        }
        if (oauthMissingLastName && trimmedLastName) {
          updatePayload.lastName = trimmedLastName;
        }

        await clerkUser.update(updatePayload);
        redirectEtterAuth();
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
    [
      signUp,
      setActive,
      clerkUser,
      username,
      firstName,
      lastName,
      oauthMissingFirstName,
      oauthMissingLastName,
      usernameStatus,
      t,
      redirectEtterAuth,
    ],
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
        // Gjenopprett hvis sign-up allerede er ferdig (e.g. re-klikk etter suksess)
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

      {/* Post-OAuth: OAuth-konto-konflikt — blokker tidlig */}
      {isVerified && step === "oauth-username" && oauthConflict && (
        <AuthCard>
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <AuthHeader
              title={t("auth.signUp.oauthConflict.title")}
              subtitle={t("auth.signUp.oauthConflict.description")}
            />
            <Link
              href={signInHref}
              className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {t("auth.signUp.oauthConflict.backToSignIn")}
            </Link>
          </div>
        </AuthCard>
      )}

      {/* Post-OAuth: sjekker for konflikter... */}
      {isVerified && step === "oauth-username" && oauthConflictChecking && !oauthConflict && (
        <AuthCard>
          <LoadingView
            fullPage={false}
            translationKey="common.loading.generic"
          />
        </AuthCard>
      )}

      {/* Post-OAuth: velg brukernavn (og evt. navn hvis OAuth-provider ikke ga det) */}
      {isVerified && step === "oauth-username" && !oauthConflict && !oauthConflictChecking && (
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

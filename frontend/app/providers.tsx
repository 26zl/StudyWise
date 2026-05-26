/*
 * Tanstack React Query for global state management og data fetching
 * Håndterer caching, synkronisering og oppdatering av server state i React applikasjonen
 */
// "use client" forteller Next.js at denne filen kjører i nettleseren.
// Dette er nødvendig for biblioteker som bruker React Context (som React Query).
"use client";

import { ClerkProvider, RedirectToTasks, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { enUS, nbNO } from "@clerk/localizations";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { MotionConfig } from "framer-motion";
import { useAuthSync, clearClientAuthState } from "./hooks/use-auth-sync";
import { setClerkGetToken, setClerkSessionReload } from "./lib/clerkTokenForApi";
import { setDatadogUser, clearDatadogUser } from "@/app/components/layout/DatadogRum";
import { identifyPostHogUser, resetPostHogUser } from "@/app/components/layout/PostHogAnalytics";
import { AUTH_ME_QUERY_KEY, prefetchMe, forceSyncMe, dismissSyncConflict } from "./auth/auth-api";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { MeResponseSchema, type MeResponse, type SyncConflict } from "common/auth";
import { LanguageProvider, useLanguage } from "@/app/i18n";
import type { Language } from "@/app/i18n/types";
import { getApiErrorCode, getFatalUserDataReason } from "./lib/errorUtils";
import { showToast } from "@/app/components/ui/Toaster";
import { TurnstileReChallenge } from "./auth/TurnstileReChallenge";

function normalizeProfileField(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function ClerkProviderMedSprak({
  children,
  clerkPublishableKey,
  nonce,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  nonce?: string;
}) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const baseLocale = isEnglish ? enUS : nbNO;

  const backupCodePageLocalization = isEnglish
    ? {
        infoText1: "Backup codes will be enabled for this account.",
        infoText2:
          "Keep your codes private and store them somewhere safe. Generate new codes if you think the old ones may be compromised.",
        subtitle__codelist: "Store these codes somewhere safe. Each code can only be used once.",
        successMessage:
          "Backup codes are enabled. Use one of them to sign in if you lose access to your authenticator app. Each code can only be used once.",
        successSubtitle: "Use one of these codes if you lose access to your authenticator app.",
        title: "Enable backup codes",
        title__codelist: "Backup codes",
      }
    : {
        infoText1: "Backup-koder aktiveres for denne kontoen.",
        infoText2:
          "Hold kodene hemmelige og lagre dem trygt. Generer nye koder hvis du tror de kan være kompromittert.",
        subtitle__codelist: "Lagre kodene et trygt sted. Hver kode kan bare brukes én gang.",
        successMessage:
          "Backup-koder er aktivert. Bruk én av dem for å logge inn hvis du mister tilgang til autentiseringsappen. Hver kode kan bare brukes én gang.",
        successSubtitle: "Bruk én av kodene hvis du mister tilgang til autentiseringsappen.",
        title: "Aktiver backup-koder",
        title__codelist: "Backup-koder",
      };

  const backupCodesSectionLocalization = isEnglish
    ? {
        actionLabel__regenerate: "Generate new codes",
        headerTitle: "Backup codes",
        subtitle__regenerate:
          "This creates a new set of backup codes. Old codes will be deleted and can no longer be used.",
        title__regenerate: "Generate new backup codes",
      }
    : {
        actionLabel__regenerate: "Generer nye koder",
        headerTitle: "Backup-koder",
        subtitle__regenerate:
          "Dette lager et nytt sett backup-koder. Gamle koder slettes og kan ikke brukes.",
        title__regenerate: "Generer nye backup-koder",
      };

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey ?? undefined}
      localization={{
        ...baseLocale,
        formFieldInputPlaceholder__backupCode: isEnglish
          ? "Enter backup code"
          : "Skriv inn backup-kode",
        formFieldLabel__backupCode: isEnglish ? "Backup code" : "Backup-kode",
        reverification: {
          ...baseLocale.reverification,
          alternativeMethods: {
            ...baseLocale.reverification?.alternativeMethods,
            blockButton__backupCode: isEnglish ? "Use backup code" : "Bruk backup-kode",
          },
          backupCodeMfa: {
            ...baseLocale.reverification?.backupCodeMfa,
            subtitle: isEnglish
              ? "Use a backup code you saved when you set up two-factor authentication."
              : "Bruk en backup-kode du lagret da du satte opp tofaktor.",
            title: isEnglish ? "Enter backup code" : "Skriv inn backup-kode",
          },
        },
        signIn: {
          ...baseLocale.signIn,
          alternativeMethods: {
            ...baseLocale.signIn?.alternativeMethods,
            blockButton__backupCode: isEnglish ? "Use backup code" : "Bruk backup-kode",
          },
          backupCodeMfa: {
            ...baseLocale.signIn?.backupCodeMfa,
            subtitle: isEnglish
              ? "Use a backup code you saved when you set up two-factor authentication."
              : "Bruk en backup-kode du lagret da du satte opp tofaktor.",
            title: isEnglish ? "Enter backup code" : "Skriv inn backup-kode",
          },
        },
        signUp: {
          ...baseLocale.signUp,
          emailCode: {
            ...baseLocale.signUp?.emailCode,
            subtitle: isEnglish
              ? "We sent a verification code to {{identifier}}. It may take a moment to arrive"
              : "Vi sendte en verifiseringskode til {{identifier}}. Det kan ta litt tid før den ankommer",
          },
        },
        userProfile: {
          ...baseLocale.userProfile,
          backupCodePage: {
            ...baseLocale.userProfile?.backupCodePage,
            ...backupCodePageLocalization,
          },
          start: {
            ...baseLocale.userProfile?.start,
            mfaSection: {
              ...baseLocale.userProfile?.start?.mfaSection,
              backupCodes: {
                ...baseLocale.userProfile?.start?.mfaSection?.backupCodes,
                ...backupCodesSectionLocalization,
              },
            },
            profileSection: {
              ...baseLocale.userProfile?.start?.profileSection,
              primaryButton: isEnglish ? "Update profile" : "Oppdater profil",
            },
          },
        },
      }}
      appearance={{
        elements: {
          badge: {
            color: "var(--clerk-badge-color, #475569)",
            opacity: 1,
          },
        },
      }}
      signInUrl="/auth/sign-in"
      signUpUrl="/auth/sign-up"
      taskUrls={{ "setup-mfa": "/auth/tasks/setup-mfa" }}
      nonce={nonce}
      dynamic
    >
      {children}
    </ClerkProvider>
  );
}

function SessionTaskRedirect() {
  const pathname = usePathname();
  if (pathname.startsWith("/auth/tasks/")) return null;
  return <RedirectToTasks />;
}

// Gir backend API tilgang til Clerk session token (for brukere som logger inn med Clerk)
function ClerkTokenSync() {
  const { getToken } = useAuth();
  const clerk = useClerk();
  useEffect(() => {
    setClerkGetToken(() => getToken());
    // Registrer session-reload for defensiv 401-retry i hentMeg og lignende.
    // Best-effort: hvis clerk.session er null (ikke innlogget), gjør reload-kallet ingenting.
    setClerkSessionReload(async () => {
      await clerk.session?.reload();
    });
    return () => {
      setClerkGetToken(null);
      setClerkSessionReload(null);
    };
  }, [getToken, clerk]);
  return null;
}

// Komponent for å lytte etter utlogging i andre faner
function AuthSyncListener() {
  useAuthSync(); // Aktiver lytter for utlogging i andre faner
  return null;
}

// Prefetch /me umiddelbart når bruker er innlogget — unngår forsinkelse fra requestIdleCallback
function PrefetchMeOnMount() {
  const queryClient = useQueryClient();
  const { isLoaded, userId } = useAuth();
  useEffect(() => {
    if (!isLoaded || !userId) return;
    prefetchMe(queryClient);
  }, [isLoaded, userId, queryClient]);
  return null;
}

// Synkroniserer Datadog RUM bruker-ID med auth-status
function DatadogUserSync() {
  const queryClient = useQueryClient();
  const { isLoaded, userId: clerkUserId } = useAuth();

  const syncDatadogUser = useCallback(() => {
    if (!isLoaded) return;

    if (!clerkUserId) {
      try {
        clearDatadogUser();
      } catch {
        /* Datadog RUM ikke kritisk */
      }
      try {
        resetPostHogUser();
      } catch {
        /* PostHog ikke kritisk */
      }
      return;
    }

    const meData = queryClient.getQueryData<MeResponse>(AUTH_ME_QUERY_KEY);
    const datadogUser =
      meData?.user?.id != null
        ? { id: clerkUserId, studywiseUserId: meData.user.id }
        : { id: clerkUserId };

    try {
      setDatadogUser(datadogUser);
    } catch {
      // Datadog RUM er ikke kritisk – la appen fortsette
    }

    // PostHog identify — bruker Clerk user-ID som stabil distinctId. I cookieless-modus
    // gjelder koblingen kun for inneværende sesjon, men lar oss fortsatt segmentere
    // events på innloggede brukere innen sesjonen.
    try {
      identifyPostHogUser(clerkUserId, {
        studywiseUserId: meData?.user?.id,
      });
    } catch {
      // PostHog er ikke kritisk – la appen fortsette
    }
  }, [clerkUserId, isLoaded, queryClient]);

  useEffect(() => {
    syncDatadogUser();
  }, [syncDatadogUser]);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event?.type === "updated" &&
        event.query.queryKey[0] === AUTH_ME_QUERY_KEY[0] &&
        event.query.queryKey[1] === AUTH_ME_QUERY_KEY[1]
      ) {
        syncDatadogUser();
      }
    });
    return unsubscribe;
  }, [queryClient, syncDatadogUser]);

  return null;
}

/**
 * Overvåker /me-query for fatale kontokonflikter (OAuth-konto allerede koblet til en annen bruker,
 * slettet konto, etc.) og trigger automatisk Clerk sign-out for å unngå stuck-state der bruker
 * er autentisert i Clerk men avvist av backend.
 */
function AuthConflictGuard() {
  const queryClient = useQueryClient();
  const clerk = useClerk();
  const { t } = useLanguage();
  const signOutTriggeredRef = useRef(false);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (signOutTriggeredRef.current) return;
      if (
        event?.type === "updated" &&
        event.query.queryKey[0] === AUTH_ME_QUERY_KEY[0] &&
        event.query.queryKey[1] === AUTH_ME_QUERY_KEY[1] &&
        event.query.state.status === "error"
      ) {
        const error = event.query.state.error;
        // Ignorer Turnstile-re-challenge — håndteres av TurnstileReChallenge-komponenten
        if (getApiErrorCode(error) === "turnstile_required") return;

        const fatalReason = getFatalUserDataReason(error);
        if (fatalReason) {
          signOutTriggeredRef.current = true;
          const erSlettet = fatalReason === "user_deleted";
          const erLaast = fatalReason === "user_locked";
          const erOAuthKonflikt =
            fatalReason === "oauth_account_conflict" || fatalReason === "oauth_metadata_missing";
          const erEpostKonflikt = fatalReason === "account_conflict";

          let feilmelding: string;
          if (erSlettet) {
            feilmelding = t("auth.conflictRedirect.accountDeleted");
          } else if (erLaast) {
            feilmelding = t("auth.conflictRedirect.accountLocked");
          } else if (erOAuthKonflikt) {
            feilmelding = t("auth.conflictRedirect.oauthConflict");
          } else if (erEpostKonflikt) {
            feilmelding = t("auth.conflictRedirect.emailConflict");
          } else {
            feilmelding = t("auth.conflictRedirect.accountConflict");
          }

          const maalside = erSlettet ? "/auth/sign-up" : "/auth/sign-in";
          const redirectUrl = `${maalside}?error=${encodeURIComponent(feilmelding)}`;
          // Ved kryssmiljø-relink kan Clerk.signOut() feile fordi sesjonen allerede
          // er ugyldig. Vi logger, men rydder lokal state og redirecter uansett.
          void clerk
            .signOut()
            .catch((error) => {
              console.warn(
                "Clerk signOut feilet under AuthConflictGuard-redirect:",
                (error as { code?: string })?.code ?? "unknown",
              );
            })
            .finally(() => {
              clearClientAuthState(queryClient);
              window.location.replace(redirectUrl);
            });
        }
      }
    });
    return unsubscribe;
  }, [clerk, queryClient, t]);

  return null;
}

function ClerkProfileCacheSync() {
  const queryClient = useQueryClient();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: clerkUserLoaded, user } = useUser();
  const forceSyncInFlightRef = useRef(false);

  const triggerBackendProfileSync = useCallback(async () => {
    if (forceSyncInFlightRef.current) return;
    forceSyncInFlightRef.current = true;
    try {
      await forceSyncMe(queryClient);
    } catch {
      // Ikke vis toast her — auth/query-laget håndterer eventuelle reelle feil.
    } finally {
      forceSyncInFlightRef.current = false;
    }
  }, [queryClient]);

  // Synkroniser firstName og lastName optimistisk fra Clerk til React Query-cache.
  // Brukernavn og e-post synkes ikke optimistisk her — backend er autoritativ
  // fordi begge kan avvises ved konflikt og må bekreftes via /api/user/me.
  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) {
      return;
    }

    const nextFirstName = normalizeProfileField(user?.firstName);
    const nextLastName = normalizeProfileField(user?.lastName);

    queryClient.setQueryData<MeResponse | undefined>(AUTH_ME_QUERY_KEY, (current) => {
      if (!current) {
        return current;
      }

      const currentUser = current.user;
      const hasChanges =
        currentUser.firstName !== nextFirstName || currentUser.lastName !== nextLastName;

      if (!hasChanges) {
        return current;
      }

      return MeResponseSchema.parse({
        user: {
          ...currentUser,
          firstName: nextFirstName,
          lastName: nextLastName,
        },
      });
    });
  }, [authLoaded, clerkUserLoaded, queryClient, user?.firstName, user?.lastName, userId]);

  // Spor externalAccounts (Google/Microsoft-koblinger) og tving backend-sync
  // når bruker kobler til/fra en OAuth-provider via Clerk UserProfile.
  const externalAccountsKey =
    user?.externalAccounts
      ?.map((a) => `${a.provider}:${a.id}`)
      .sort()
      .join(",") ?? "";
  const prevExternalAccountsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) return;

    const prev = prevExternalAccountsRef.current;
    prevExternalAccountsRef.current = externalAccountsKey;

    // Ignorer første observerte verdi — kun reager på reelle endringer etter initial lasting.
    if (prev === null || prev === externalAccountsKey) return;

    void triggerBackendProfileSync();
  }, [authLoaded, clerkUserLoaded, externalAccountsKey, triggerBackendProfileSync, userId]);

  // E-post er aktiv i Clerk UserProfile, så vi må tvinge backend-synk når
  // primær e-post eller e-postlisten endrer seg.
  const primaryEmailKey = [
    user?.primaryEmailAddressId ?? "",
    user?.primaryEmailAddress?.emailAddress ?? "",
    user?.primaryEmailAddress?.verification?.status ?? "",
  ].join(":");
  const emailAddressesKey =
    user?.emailAddresses
      ?.map((address) =>
        [address.id, address.emailAddress, address.verification?.status ?? ""].join(":"),
      )
      .sort()
      .join(",") ?? "";
  const clerkEmailStateKey = `${primaryEmailKey}|${emailAddressesKey}`;
  const prevClerkEmailStateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) return;

    const prev = prevClerkEmailStateRef.current;
    prevClerkEmailStateRef.current = clerkEmailStateKey;

    // Ignorer første observerte verdi — kun reager på reelle endringer etter initial lasting.
    if (prev === null || prev === clerkEmailStateKey) return;

    void triggerBackendProfileSync();
  }, [authLoaded, clerkEmailStateKey, clerkUserLoaded, triggerBackendProfileSync, userId]);

  // Spor MFA-status (TOTP/2FA) og tving backend-sync når brukeren aktiverer
  // eller deaktiverer tofaktorautentisering via Clerk UserProfile. Uten dette
  // vil admin-visninger og sikkerhetsbaserte features se stale mfaEnabled i
  // opptil 5 minutter (CLERK_PROFILE_SYNC_INTERVAL_MS).
  const twoFactorEnabled = user?.twoFactorEnabled ?? false;
  const prevTwoFactorRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) return;

    const prev = prevTwoFactorRef.current;
    prevTwoFactorRef.current = twoFactorEnabled;

    if (prev === null || prev === twoFactorEnabled) return;

    void triggerBackendProfileSync();
  }, [authLoaded, clerkUserLoaded, triggerBackendProfileSync, twoFactorEnabled, userId]);

  // Spor backup-codes-status: brukeren genererer dem via Clerk UserProfile,
  // og vi vil at BackupCodesBanner-en skal forsvinne umiddelbart etterpå
  // i stedet for å vente på neste profile-sync (opptil 5 min).
  const backupCodeEnabled = user?.backupCodeEnabled ?? false;
  const prevBackupCodeRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) return;

    const prev = prevBackupCodeRef.current;
    prevBackupCodeRef.current = backupCodeEnabled;

    if (prev === null || prev === backupCodeEnabled) return;

    void triggerBackendProfileSync();
  }, [authLoaded, clerkUserLoaded, triggerBackendProfileSync, backupCodeEnabled, userId]);

  return null;
}

/**
 * Viser en advarselsbanner når det finnes aktive Clerk↔lokal synkroniseringskonflikter
 * (f.eks. e-post eller OAuth-kobling som backend avviste).
 */
function SyncConflictBanner() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { isLoaded, userId } = useAuth();
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !userId) return;

    function syncFromCache() {
      const meData = queryClient.getQueryData<MeResponse>(AUTH_ME_QUERY_KEY);
      setConflicts(meData?.user?.syncConflicts ?? []);
    }

    syncFromCache();

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event?.type === "updated" &&
        event.query.queryKey[0] === AUTH_ME_QUERY_KEY[0] &&
        event.query.queryKey[1] === AUTH_ME_QUERY_KEY[1] &&
        event.query.state.status === "success"
      ) {
        syncFromCache();
      }
    });
    return unsubscribe;
  }, [isLoaded, userId, queryClient]);

  const handleDismiss = useCallback(
    async (type: SyncConflict["type"]) => {
      setDismissing(type);
      try {
        await dismissSyncConflict(type);
        setConflicts((prev) => prev.filter((c) => c.type !== type));
        queryClient.setQueryData<MeResponse | undefined>(AUTH_ME_QUERY_KEY, (current) => {
          if (!current) return current;
          return {
            ...current,
            user: {
              ...current.user,
              syncConflicts: (current.user.syncConflicts ?? []).filter((c) => c.type !== type),
            },
          };
        });
      } catch {
        showToast.error(t("common.labels.error"), t("auth.syncConflict.dismissError"));
      } finally {
        setDismissing(null);
      }
    },
    [queryClient, t],
  );

  if (conflicts.length === 0) return null;

  return (
    <div
      className="fixed right-4 z-50 flex max-w-md flex-col gap-2"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      {conflicts.map((c) => (
        <div
          key={c.type}
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg dark:border-amber-700 dark:bg-amber-950/90"
        >
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {c.type === "email_mismatch"
              ? t("auth.syncConflict.emailMismatchTitle")
              : t("auth.syncConflict.oauthLinkRejectedTitle")}
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{c.melding}</p>
          <button
            type="button"
            onClick={() => void handleDismiss(c.type)}
            disabled={dismissing === c.type}
            className="mt-2 rounded-md bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-300 disabled:opacity-50 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
          >
            {dismissing === c.type
              ? t("auth.syncConflict.dismissing")
              : t("auth.syncConflict.dismiss")}
          </button>
        </div>
      ))}
    </div>
  );
}

// Synkroniserer UI-preferanser (sprak, tema, cookie-samtykke) med backend
function PreferencesSync() {
  usePreferencesSync();
  return null;
}

export function Providers({
  children,
  clerkPublishableKey,
  initialLanguage,
  nonce,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  initialLanguage: Language;
  nonce?: string;
}) {
  // Lager en instans av QueryClient som håndterer caching av data.
  // useState sikrer at clienten bare lages én gang per sesjon (ikke på hver render).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // Data er "fersk" i 1 minutt
            gcTime: 5 * 60 * 1000, // Hold i minnet i 5 minutter (cache > stale for bedre UX)
            retry: 2, // Maks 2 retries — raskere feilmelding til bruker
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000), // Exponential backoff: 1s, 2s, 4s
            refetchOnWindowFocus: false, // Unngå unødvendige refetches
          },
          mutations: {
            retry: 0, // Mutations (auth, delete, POST) bør ikke retries automatisk
          },
        },
      }),
  );

  // Pakker inn applikasjonen (children) med Provideren.
  // Dette gjør at alle komponenter inni kan bruke hooks som useQuery().
  return (
    <LanguageProvider initialLanguage={initialLanguage}>
      <ClerkProviderMedSprak clerkPublishableKey={clerkPublishableKey} nonce={nonce}>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            {/* reducedMotion="user" — framer-motion respekterer prefers-reduced-motion
                automatisk på tvers av alle motion-komponenter (WCAG 2.3.3). */}
            <MotionConfig reducedMotion="user">
              <SessionTaskRedirect />
              <ClerkTokenSync />
              <AuthSyncListener />
              <AuthConflictGuard />
              <TurnstileReChallenge />
              <PrefetchMeOnMount />
              <DatadogUserSync />
              <ClerkProfileCacheSync />
              <SyncConflictBanner />
              <PreferencesSync />
              {children}
            </MotionConfig>
          </NuqsAdapter>
        </QueryClientProvider>
      </ClerkProviderMedSprak>
    </LanguageProvider>
  );
}

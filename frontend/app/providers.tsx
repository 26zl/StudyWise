/*
* Tanstack React Query for global state management og data fetching
* Håndterer caching, synkronisering og oppdatering av server state i React applikasjonen
*/
// "use client" forteller Next.js at denne filen kjører i nettleseren.
// Dette er nødvendig for biblioteker som bruker React Context (som React Query).
"use client";

import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { enUS, nbNO } from "@clerk/localizations";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useAuthSync, clearClientAuthState } from "./hooks/use-auth-sync";
import { setClerkGetToken } from "./lib/clerkTokenForApi";
import { setDatadogUser, clearDatadogUser } from "@/app/components/layout/DatadogRum";
import { AUTH_ME_QUERY_KEY, prefetchMe, forceSyncMe, dismissSyncConflict } from "./auth/auth-api";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { MeResponseSchema, type MeResponse, type SyncConflict } from "common/auth";
import { LanguageProvider, useLanguage } from "@/app/i18n";
import type { Language } from "@/app/i18n/types";
import { erFatalUserDataFeilmelding } from "./lib/errorUtils";
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

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey ?? undefined}
      localization={language === "en" ? enUS : nbNO}
      signInUrl="/auth/sign-in"
      signUpUrl="/auth/sign-up"
      nonce={nonce}
      dynamic
    >
      {children}
    </ClerkProvider>
  );
}

// Gir backend API tilgang til Clerk session token (for brukere som logger inn med Clerk)
function ClerkTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setClerkGetToken(() => getToken());
    return () => setClerkGetToken(null);
  }, [getToken]);
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
      try { clearDatadogUser(); } catch { /* Datadog RUM ikke kritisk */ }
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
        const msg = error instanceof Error ? error.message : "";
        // Ignorer Turnstile-re-challenge — håndteres av TurnstileReChallenge-komponenten
        if (/turnstile_required/i.test(msg) || /sikkerhetsverifisering utløpt/i.test(msg)) return;
        if (erFatalUserDataFeilmelding(msg)) {
          signOutTriggeredRef.current = true;
          const erSlettet = /kontoen er slettet/i.test(msg);
          const erOAuthKonflikt = /allerede koblet til en annen studywise/i.test(msg);
          const erEpostKonflikt = /allerede en konto med denne e-postadressen/i.test(msg);

          let feilmelding: string;
          if (erSlettet) {
            feilmelding = t("auth.conflictRedirect.accountDeleted");
          } else if (erOAuthKonflikt) {
            feilmelding = t("auth.conflictRedirect.oauthConflict");
          } else if (erEpostKonflikt) {
            feilmelding = t("auth.conflictRedirect.emailConflict");
          } else {
            feilmelding = t("auth.conflictRedirect.accountConflict");
          }

          const maalside = erSlettet ? "/auth/sign-up" : "/auth/sign-in";
          const redirectUrl = `${maalside}?error=${encodeURIComponent(feilmelding)}`;
          void clerk.signOut().catch(() => {}).finally(() => {
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

  // Synkroniser firstName og lastName fra Clerk til React Query-cache.
  // Brukernavn synkes IKKE her — server er autoritativ for brukernavn
  // fordi backend kan avvise Clerk-brukernavnet ved konflikt.
  // E-post synkes IKKE her — lokal DB er autoritativ for e-post.
  // Clerk-managed e-postendring er deaktivert i UserProfile UI, og backend
  // kan avvise e-postendringer som konflikter med andre brukere.
  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) {
      return;
    }

    const nextFirstName = normalizeProfileField(user?.firstName);
    const nextLastName = normalizeProfileField(user?.lastName);

    queryClient.setQueryData<MeResponse | undefined>(
      AUTH_ME_QUERY_KEY,
      (current) => {
        if (!current) {
          return current;
        }

        const currentUser = current.user;
        const hasChanges =
          currentUser.firstName !== nextFirstName ||
          currentUser.lastName !== nextLastName;

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
      },
    );
  }, [
    authLoaded,
    clerkUserLoaded,
    queryClient,
    user?.firstName,
    user?.lastName,
    userId,
  ]);

  // Spor externalAccounts (Google/Microsoft-koblinger) og tving backend-sync
  // når bruker kobler til/fra en OAuth-provider via Clerk UserProfile.
  const externalAccountsKey = user?.externalAccounts
    ?.map((a) => `${a.provider}:${a.id}`)
    .sort()
    .join(",") ?? "";
  const prevExternalAccountsRef = useRef(externalAccountsKey);

  useEffect(() => {
    if (!authLoaded || !userId || !clerkUserLoaded) return;

    const prev = prevExternalAccountsRef.current;
    prevExternalAccountsRef.current = externalAccountsKey;

    // Ignorer første render (initial load) — kun reager på endringer
    if (prev === externalAccountsKey || prev === "") return;

    void forceSyncMe(queryClient);
  }, [authLoaded, clerkUserLoaded, userId, externalAccountsKey, queryClient]);

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

  const handleDismiss = useCallback(async (type: SyncConflict["type"]) => {
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
  }, [queryClient]);

  if (conflicts.length === 0) return null;

  return (
    <div className="fixed right-4 z-50 flex max-w-md flex-col gap-2" style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
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
            staleTime: 60 * 1000,       // Data er "fersk" i 1 minutt
            gcTime: 5 * 60 * 1000,      // Hold i minnet i 5 minutter (cache > stale for bedre UX)
            retry: 2,                    // Maks 2 retries — raskere feilmelding til bruker
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000), // Exponential backoff: 1s, 2s, 4s
            refetchOnWindowFocus: false, // Unngå unødvendige refetches
          },
        },
      })
  );

  // Pakker inn applikasjonen (children) med Provideren.
  // Dette gjør at alle komponenter inni kan bruke hooks som useQuery().
  return (
    <LanguageProvider initialLanguage={initialLanguage}>
      <ClerkProviderMedSprak clerkPublishableKey={clerkPublishableKey} nonce={nonce}>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
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
          </NuqsAdapter>
        </QueryClientProvider>
      </ClerkProviderMedSprak>
    </LanguageProvider>
  );
}

/*
* Tanstack React Query for global state management og data fetching
* Håndterer caching, synkronisering og oppdatering av server state i React applikasjonen
*/
// "use client" forteller Next.js at denne filen kjører i nettleseren.
// Dette er nødvendig for biblioteker som bruker React Context (som React Query).
"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { enUS, nbNO } from "@clerk/localizations";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useAuthSync } from "./hooks/use-auth-sync";
import { setClerkGetToken } from "./lib/clerkTokenForApi";
import { setDatadogUser, clearDatadogUser } from "@/app/components/layout/DatadogRum";
import { AUTH_ME_QUERY_KEY, prefetchMe } from "./auth/auth-api";
import type { MeResponse } from "common/auth";
import { LanguageProvider, useLanguage } from "@/app/i18n";
import type { Language } from "@/app/i18n/types";

function ClerkProviderMedSprak({
  children,
  clerkPublishableKey,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
}) {
  const { language } = useLanguage();

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey ?? undefined}
      localization={language === "en" ? enUS : nbNO}
      signInUrl="/auth/sign-in"
      signUpUrl="/auth/sign-up"
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

export function Providers({
  children,
  clerkPublishableKey,
  initialLanguage,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  initialLanguage: Language;
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
      <ClerkProviderMedSprak clerkPublishableKey={clerkPublishableKey}>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            <ClerkTokenSync />
            <AuthSyncListener />
            <PrefetchMeOnMount />
            <DatadogUserSync />
            {children}
          </NuqsAdapter>
        </QueryClientProvider>
      </ClerkProviderMedSprak>
    </LanguageProvider>
  );
}

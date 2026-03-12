/*
* Tanstack React Query for global state management og data fetching
* Håndterer caching, synkronisering og oppdatering av server state i React applikasjonen
*/
// "use client" forteller Next.js at denne filen kjører i nettleseren.
// Dette er nødvendig for biblioteker som bruker React Context (som React Query).
"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useAuthSync } from "./hooks/use-auth-sync";
import { setDatadogUser, clearDatadogUser } from "./components/DatadogRum";
import type { MeResponse } from "common/auth";

// Komponent for å lytte etter utlogging i andre faner
function AuthSyncListener() {
  useAuthSync(); // Aktiver lytter for utlogging i andre faner
  return null;
}

// Synkroniserer Datadog RUM bruker-ID med auth-status
function DatadogUserSync() {
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const meData = queryClient.getQueryData<MeResponse>(["auth", "me"]);
      const userId = meData?.user?.id ?? null;

      if (userId !== prevUserIdRef.current) {
        prevUserIdRef.current = userId;
        if (userId) {
          setDatadogUser(userId);
        } else {
          clearDatadogUser();
        }
      }
    });
    return unsubscribe;
  }, [queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Lager en instans av QueryClient som håndterer caching av data.
  // useState sikrer at clienten bare lages én gang per sesjon (ikke på hver render).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,       // Data er "fersk" i 1 minutt
            gcTime: 5 * 60 * 1000,      // Hold i minnet i 5 minutter (cache > stale for bedre UX)
            retry: 3,                    // Prøv på nytt 3 ganger ved feil (håndterer oppstarts-timing)
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff: 1s, 2s, 4s...
            refetchOnWindowFocus: false, // Unngå unødvendige refetches
          },
        },
      })
  );

  // Pakker inn applikasjonen (children) med Provideren.
  // Dette gjør at alle komponenter inni kan bruke hooks som useQuery().
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <AuthSyncListener />
        <DatadogUserSync />
        {children}
      </NuqsAdapter>
    </QueryClientProvider>
  );
}

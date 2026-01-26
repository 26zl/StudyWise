/*
* Tanstack React Query for global state management og data fetching
* Håndterer caching, synkronisering og oppdatering av server state i React applikasjonen
*/
// "use client" forteller Next.js at denne filen kjører i nettleseren.
// Dette er nødvendig for biblioteker som bruker React Context (som React Query).
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { prefetchCanvasData } from "./canvas/canvas-api";

export function Providers({ children }: { children: React.ReactNode }) {
  // Lager en instans av QueryClient som håndterer caching av data.
  // useState sikrer at clienten bare lages én gang per sesjon (ikke på hver render).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // Data er "fersk" i 5 minutter
            gcTime: 10 * 60 * 1000,   // Hold i minnet i 10 minutter
            retry: 1, // Prøv på nytt 1 gang ved feil
          },
        },
      })
  );

  // Prefetch Canvas data ved app-start for raskere brukeropplevelse
  useEffect(() => {
    prefetchCanvasData(queryClient);
  }, [queryClient]);

  // Pakker inn applikasjonen (children) med Provideren.
  // Dette gjør at alle komponenter inni kan bruke hooks som useQuery().
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * CanvasStatusBanner — én global banner når Canvas-integrasjonen er nede.
 *
 * Backend returnerer 503 med `kilde: "canvas"` + `status: "outage" | "maintenance"`
 * når Canvas-API-et ikke svarer (typisk planlagt vedlikehold, eller når
 * sirkulærbreakeren har trippet etter gjentatte upstream-feil). Hver Canvas-
 * widget i dashboardet ville ellers ha rendret sitt eget feilkort — denne
 * banneret samler signalet til én tydelig melding på toppen av appen.
 *
 * Vi observerer React Query-cachen direkte i stedet for å koble banneret til
 * hver useCanvas*-hook, slik at banneret automatisk dekker alle nåværende og
 * fremtidige Canvas-queries (deres queryKey starter med "canvas").
 *
 * Bruker `useSyncExternalStore` (React 18+) i stedet for useEffect+setState —
 * QueryCache.subscribe fyrer under render-fasen til andre komponenter, og en
 * manuell setState-løsning ville krasje med "Cannot update a component while
 * rendering a different component". useSyncExternalStore er bygget for dette.
 */
"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, X } from "lucide-react";
import { CanvasOutageError } from "@/app/lib/errors";

/**
 * Finner det nyeste Canvas-utfallet i query-cachen. Returnerer feilreferansen
 * direkte (ikke et nytt objekt per kall) slik at useSyncExternalStore sin
 * Object.is-sjekk gir stabile snapshots — ellers ville hver subscribe-tick
 * trigget en ny render selv uten faktisk endring.
 */
function findLatestCanvasOutageError(queryClient: QueryClient): CanvasOutageError | null {
  const queries = queryClient.getQueryCache().getAll();
  let latestError: CanvasOutageError | null = null;
  let latestUpdatedAt = 0;
  for (const query of queries) {
    const key = query.queryKey;
    if (!Array.isArray(key) || key[0] !== "canvas") continue;
    const error = query.state.error;
    if (!CanvasOutageError.isCanvasOutage(error)) continue;
    const updatedAt = query.state.errorUpdatedAt ?? 0;
    if (updatedAt > latestUpdatedAt) {
      latestUpdatedAt = updatedAt;
      latestError = error;
    }
  }
  return latestError;
}

function formatRetryAfter(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 60) return `Prøv igjen om ${seconds} sekunder.`;
  const minutes = Math.ceil(seconds / 60);
  return `Prøv igjen om ${minutes} minutt${minutes === 1 ? "" : "er"}.`;
}

export function CanvasStatusBanner() {
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();

  // Stabile referanser — useSyncExternalStore re-subscriber hvis disse endrer
  // identitet hver render. Vi filtrerer cache-events til kun canvas-queries
  // her i subscribe-laget, slik at getSnapshot (som itererer alle queries)
  // ikke kjøres på hvert KI-/KB-/me-cache-event som ikke kan endre snapshotet.
  const subscribe = useCallback(
    (cb: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event?.query?.queryKey;
        if (Array.isArray(key) && key[0] === "canvas") {
          cb();
        }
      }),
    [queryClient],
  );
  const getSnapshot = useCallback(() => findLatestCanvasOutageError(queryClient), [queryClient]);
  const getServerSnapshot = useCallback(() => null, []);

  const outage = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Dismiss er per-feilreferanse, in-memory. Hvis brukeren laster siden på
  // nytt mens utfallet pågår er det riktig at banneret kommer tilbake — vi
  // vil ikke at en gammel sessionStorage-flag skal skjule en aktiv outage.
  const [dismissedError, setDismissedError] = useState<CanvasOutageError | null>(null);

  if (!isLoaded || !userId) return null;
  if (!outage) return null;
  if (dismissedError === outage) return null;

  const retryHint = formatRetryAfter(outage.retryAfterSeconds);
  const headline =
    outage.outageStatus === "maintenance"
      ? "Canvas er nede for vedlikehold"
      : "Canvas er midlertidig utilgjengelig";

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 leading-snug">
        <span className="font-medium">{headline}.</span> Kalender, kunngjøringer og kursdata kan
        mangle eller være utdaterte.
        {retryHint ? ` ${retryHint}` : ""}
      </p>
      <button
        type="button"
        onClick={() => setDismissedError(outage)}
        aria-label="Lukk"
        className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

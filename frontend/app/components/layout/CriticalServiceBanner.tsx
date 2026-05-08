/**
 * CriticalServiceBanner — varsler brukere når en kritisk plattform-tjeneste
 * er degradert eller nede. Poller `/api/status` (samme query-key som
 * /status-siden, så React Query deduper kallene) og rendrer én banner med
 * de faktisk berørte komponentene.
 *
 * Dekker kun KRITISKE komponenter — Canvas har sin egen banner,
 * `notifications` og `knowledgeBase` er stille degraderinger som ikke
 * fortjener en blokk-banner.
 *
 * Kritiske komponenter:
 *   - `authentication` (Clerk + Mongo) — bruker blir kastet ut hvis nede
 *   - `aiChat`         (Anthropic + Mongo) — kjernefeature
 *
 * Visuell stil matcher CanvasStatusBanner for konsistens: alltid amber,
 * alltid `role="status"` / `aria-live="polite"`, samme layout (ikon + bold
 * tittel + beskrivelse i samme paragraf + lukk-knapp).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { fetchApi } from "@/app/lib/apiClient";
import { PublicStatusResponseSchema, type PublicStatusResponse } from "common/system";

const DISMISSED_KEY_PREFIX = "studywise:critical-service-banner:";
const POLL_INTERVAL_MS = 60_000;
const STALE_MS = 30_000;

type CriticalKey = "authentication" | "aiChat";
const CRITICAL_COMPONENTS: readonly CriticalKey[] = ["authentication", "aiChat"];

interface AffectedComponent {
  key: CriticalKey;
  status: "degraded" | "down";
}

const COMPONENT_LABEL: Record<CriticalKey, string> = {
  authentication: "Innlogging",
  aiChat: "KI-chat",
};

function readDismissed(snapshotKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY_PREFIX + snapshotKey) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(snapshotKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISSED_KEY_PREFIX + snapshotKey, "1");
  } catch {
    /* sessionStorage utilgjengelig */
  }
}

function findAffected(data: PublicStatusResponse | undefined): AffectedComponent[] {
  if (!data) return [];
  const affected: AffectedComponent[] = [];
  for (const key of CRITICAL_COMPONENTS) {
    const status = data.components[key]?.status;
    if (status === "down" || status === "degraded") {
      affected.push({ key, status });
    }
  }
  return affected;
}

/**
 * Bygger den bold-formatterte tittelen på samme måte som CanvasStatusBanner:
 * én komponent → spesifikk melding. Flere komponenter → kombineres med "og".
 */
function buildHeadline(affected: AffectedComponent[]): string {
  if (affected.length === 0) return "";
  const labels = affected.map((c) => COMPONENT_LABEL[c.key]);
  if (labels.length === 1) {
    return `${labels[0]} er midlertidig utilgjengelig`;
  }
  // "Innlogging og KI-chat er midlertidig ustabilt"
  return `${labels.slice(0, -1).join(", ")} og ${labels[labels.length - 1]} er midlertidig ustabilt`;
}

export function CriticalServiceBanner() {
  // Deler `["public-status"]`-key med /status-siden så vi ikke poller dobbelt.
  // /api/status er public (auth: false), så dette fungerer også på auth-sider.
  const { data } = useQuery({
    queryKey: ["public-status"],
    queryFn: async () => {
      const res = await fetchApi("/api/status", { method: "GET" }, { auth: false });
      if (!res.ok) throw new Error("status fetch failed");
      return PublicStatusResponseSchema.parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: STALE_MS,
  });

  const affected = useMemo(() => findAffected(data), [data]);

  // Dismiss-snapshot dekker både hvilke komponenter som er affected og status-
  // nivået, slik at banneret vender tilbake hvis tilstanden endrer seg.
  const snapshotKey = useMemo(
    () => affected.map((c) => `${c.key}:${c.status}`).join("|"),
    [affected],
  );

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!snapshotKey) {
      setDismissed(false);
      return;
    }
    setDismissed(readDismissed(snapshotKey));
  }, [snapshotKey]);

  if (affected.length === 0 || dismissed) return null;

  const headline = buildHeadline(affected);

  const handleDismiss = () => {
    writeDismissed(snapshotKey);
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 leading-snug">
        <span className="font-medium">{headline}.</span>{" "}
        Vi jobber med saken — prøv igjen om litt.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Lukk"
        className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

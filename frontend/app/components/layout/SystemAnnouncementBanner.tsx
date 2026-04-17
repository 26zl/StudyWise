/**
 * SystemAnnouncementBanner — globalt banner publisert av admin.
 *
 * Vises øverst i appen for alle innloggede brukere (ikke admin) når admin har
 * satt en aktiv melding. Poller GET /api/announcement hvert 2. minutt og
 * pauses når nettleserfanen er i bakgrunnen. Brukeren kan lukke banneret
 * lokalt (via sessionStorage per-melding) hvis meldingen er `dismissible`.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Info, X } from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { fetchApi } from "@/app/lib/apiClient";
import { useMeg } from "@/app/auth/auth-api";
import { AnnouncementResponseSchema } from "common/system";

const DISMISSED_KEY_PREFIX = "studywise:announcement-dismissed:";
// 2 min: banner er ikke tidskritisk (admin publiserer manuelt ved utage, så det
// er OK om en bruker ser meldingen 2 min forsinket). Backend-cachen (30s TTL)
// sørger uansett for at Mongo kun treffes maks hvert 30. sekund på tvers av
// alle brukere, så polling-intervallet gjelder mest nettverkstrafikken.
const POLL_INTERVAL_MS = 2 * 60 * 1000;

function dismissKey(oppdatertAt: string): string {
  return `${DISMISSED_KEY_PREFIX}${oppdatertAt}`;
}

function readDismissed(oppdatertAt: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(dismissKey(oppdatertAt)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(oppdatertAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(dismissKey(oppdatertAt), "1");
  } catch {
    /* sessionStorage utilgjengelig — greit, viser banneret på nytt */
  }
}

export function SystemAnnouncementBanner() {
  const { isLoaded, userId } = useAuth();
  const { t } = useLanguage();
  const [locallyDismissed, setLocallyDismissed] = useState(false);

  // Admin-team har egne driftskanaler (status-panel i admin-panelet, Datadog,
  // Grafana) og trenger ikke se banneret — de vet allerede om det skjer noe.
  // Skjuler derfor banneret helt for admin-brukere.
  const megQuery = useMeg({ enabled: isLoaded && !!userId });
  const erAdmin = megQuery.data?.user?.role === "admin";

  const { data } = useQuery({
    queryKey: ["announcement"],
    // Ikke poll for admin — sparer en nettverkskall per minutt og unngår at
    // Query-cache holder en melding som uansett ikke skal rendres.
    enabled: isLoaded && !!userId && !erAdmin,
    queryFn: async () => {
      const res = await fetchApi("/api/announcement");
      if (!res.ok) throw new Error("Kunne ikke hente systemmelding");
      return AnnouncementResponseSchema.parse(await res.json());
    },
    staleTime: 30_000,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const aktiv = data && "active" in data && data.active === true ? data : null;
  const dismissedForThisMessage = useMemo(() => {
    if (!aktiv) return false;
    return readDismissed(aktiv.oppdatertAt);
  }, [aktiv]);

  // Reset lokal-dismissed når melding endrer seg (ny oppdatertAt)
  useEffect(() => {
    setLocallyDismissed(dismissedForThisMessage);
  }, [dismissedForThisMessage]);

  if (erAdmin) return null;
  if (!aktiv) return null;
  if (aktiv.dismissible && locallyDismissed) return null;

  const severityStyle = {
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    critical:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200",
  }[aktiv.severity];

  const Ikon = aktiv.severity === "info" ? Info : AlertTriangle;

  const handleDismiss = () => {
    writeDismissed(aktiv.oppdatertAt);
    setLocallyDismissed(true);
  };

  return (
    <div
      role={aktiv.severity === "critical" ? "alert" : "status"}
      aria-live={aktiv.severity === "critical" ? "assertive" : "polite"}
      className={`relative flex items-start gap-3 border-b px-4 py-2.5 text-sm ${severityStyle}`}
    >
      <Ikon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 leading-snug">{aktiv.melding}</p>
      {aktiv.dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("common.actions.close")}
          className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

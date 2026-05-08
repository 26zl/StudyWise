/*
 * /status — Offentlig status-side.
 * Viser live driftstatus for StudyWise, aktiv systemmelding og per-tjeneste
 * helse. Ingen auth påkrevd — brukes av brukere som vil sjekke om plattformen
 * er oppe før de logger inn.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { fetchApi } from "@/app/lib/apiClient";
import { useLanguage } from "@/app/i18n";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";
import { PublicStatusResponseSchema, type PublicStatusResponse } from "common/system";

type ComponentKey = keyof PublicStatusResponse["components"];

const COMPONENT_ORDER: ComponentKey[] = [
  "authentication",
  "aiChat",
  "knowledgeBase",
  "notifications",
  "canvas",
];

function statusDotClass(status: "operational" | "degraded" | "down"): string {
  if (status === "operational")
    return "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]";
  if (status === "degraded")
    return "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]";
  return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]";
}

function overallColorClass(overall: "operational" | "degraded" | "down"): string {
  if (overall === "operational")
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  if (overall === "degraded")
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200";
}

function announcementColorClass(severity: "info" | "warning" | "critical"): string {
  if (severity === "info")
    return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200";
  if (severity === "warning")
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  return "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200";
}

export default function StatusPage() {
  const { t } = useLanguage();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["public-status"],
    queryFn: async () => {
      const res = await fetchApi("/api/status", { method: "GET" }, { auth: false });
      if (!res.ok) throw new Error("status fetch failed");
      return PublicStatusResponseSchema.parse(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <InfoPageLayout title={t("status.title")} description={t("status.description")}>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("status.loading")}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {t("status.loadError")}
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-3 underline hover:no-underline"
          >
            {t("status.retry")}
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Samlet status */}
          <section
            className={`rounded-xl border p-5 ${overallColorClass(data.overall)}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              {data.overall === "operational" && <CheckCircle2 className="h-6 w-6" />}
              {data.overall === "degraded" && <AlertTriangle className="h-6 w-6" />}
              {data.overall === "down" && <XCircle className="h-6 w-6" />}
              <div>
                <h2 className="text-lg font-semibold">
                  {t(`status.overall.${data.overall}` as never)}
                </h2>
                <p className="mt-0.5 text-xs opacity-80">
                  {t("status.lastCheckedAt", {
                    time: new Date(data.timestamp).toLocaleString(),
                  })}
                </p>
              </div>
              {isFetching && !isLoading && (
                <Loader2 className="ml-auto h-4 w-4 animate-spin opacity-60" />
              )}
            </div>
          </section>

          {/* Aktiv systemmelding */}
          {data.announcement && (
            <section
              className={`rounded-xl border p-4 text-sm ${announcementColorClass(
                data.announcement.severity,
              )}`}
            >
              <div className="flex items-start gap-2">
                {data.announcement.severity === "info" ? (
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <p className="font-medium">{data.announcement.melding}</p>
                  <p className="mt-1 text-xs opacity-70">
                    {t("status.announcementUpdated", {
                      time: new Date(data.announcement.oppdatertAt).toLocaleString(),
                    })}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Komponenter */}
          <InfoSection title={t("status.componentsTitle")}>
            <div className="grid gap-2 sm:grid-cols-2">
              {COMPONENT_ORDER.map((component) => {
                const entry = data.components[component];
                return (
                  <div
                    key={component}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${statusDotClass(entry.status)}`}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {t(`status.components.${component}` as never)}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t(`status.componentStatus.${entry.status}` as never)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t("status.refreshNote")}
            </p>
          </InfoSection>
        </>
      )}
    </InfoPageLayout>
  );
}

/**
 * AdminSection — Admin-panel med faner for statistikk, brukere og revisjonslogg.
 * Kun synlig for brukere med admin-rolle.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Users,
  BarChart3,
  ScrollText,
  Shield,
  ShieldCheck,
  Share2,
  Eye,
  Pin,
  Link,
  Mail,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Activity,
  AlertTriangle,
  Database,
  BookOpen,
  FileText,
  RefreshCcw,
  UserX,
  Trash2,
  Check,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Bell,
  FileUp,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { useMeg } from "@/app/auth/auth-api";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { showToast } from "@/app/components/ui/Toaster";
import { formaterDatoLong, formaterDatoOgTid, formaterTall } from "@/app/lib/dato";
import { fetchApi } from "@/app/lib/apiClient";
import {
  useAdminStats,
  useAdminBrukere,
  useAdminAudit,
  useDailyMetrics,
  useLangsmithOverview,
  useRunDetail,
  useRuns,
  useEndreRolle,
  useSlettBruker,
  useClearLangsmithCache,
} from "@/app/admin/admin-api";
import type { AdminBruker } from "@/app/admin/admin-api";

type AdminFane = "stats" | "observability" | "users" | "audit" | "feedback";
type LangsmithStatusFilter = "all" | "success" | "error";

type LangsmithRunRow = {
  id: string;
  timestamp: string;
  model: string;
  intent: string;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
};

// ── Statistikk-fane ─────────────────────────────────────────────────────────

type StatKortData = {
  label: string;
  verdi: number;
  ikon: React.ElementType;
  format?: "number" | "percent";
};

function formaterStatVerdi(
  verdi: number,
  language: "nb" | "en",
  format: StatKortData["format"] = "number",
): string {
  const formatted = formaterTall(verdi, language);
  return format === "percent" ? `${formatted} %` : formatted;
}

function StatKort({
  label,
  verdi,
  ikon: Ikon,
  language,
  format,
}: {
  label: string;
  verdi: number;
  ikon: React.ElementType;
  language: "nb" | "en";
  format?: StatKortData["format"];
}) {
  return (
    <div className="flex min-h-28 items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
        <Ikon size={20} className="text-slate-600 dark:text-slate-300" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-semibold text-slate-900 dark:text-white">{formaterStatVerdi(verdi, language, format)}</p>
        <p className="text-sm leading-5 text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function StatSeksjon({
  title,
  stats,
  language,
}: {
  title: string;
  stats: StatKortData[];
  language: "nb" | "en";
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatKort
            key={stat.label}
            label={stat.label}
            verdi={stat.verdi}
            ikon={stat.ikon}
            language={language}
            format={stat.format}
          />
        ))}
      </div>
    </section>
  );
}

function StatistikkFane() {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminStats();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.errors.statsFailed")} />;

  const brukerStats: StatKortData[] = [
    { label: t("admin.stats.totalUsers"), verdi: data.brukere.totalt, ikon: Users },
    { label: t("admin.stats.adminUsers"), verdi: data.brukere.admin, ikon: ShieldCheck },
    { label: t("admin.stats.regularUsers"), verdi: data.brukere.vanlige, ikon: Users },
    { label: t("admin.stats.canvasUsers"), verdi: data.brukere.medCanvas, ikon: Link },
    { label: t("admin.stats.withoutCanvasUsers"), verdi: data.brukere.utenCanvas, ikon: UserX },
    { label: t("admin.stats.deletedUsers"), verdi: data.brukere.slettede, ikon: Trash2 },
    { label: t("admin.stats.googleUsers"), verdi: data.brukere.google, ikon: Users },
    { label: t("admin.stats.microsoftUsers"), verdi: data.brukere.microsoft, ikon: Building2 },
    { label: t("admin.stats.emailUsers"), verdi: data.brukere.email, ikon: Mail },
    { label: t("admin.stats.unknownProviderUsers"), verdi: data.brukere.ukjentProvider, ikon: AlertTriangle },
  ];

  const samtaleStats: StatKortData[] = [
    { label: t("admin.stats.totalChats"), verdi: data.samtaler.totalt, ikon: ScrollText },
    { label: t("admin.stats.bookmarkedChats"), verdi: data.samtaler.bokmerket, ikon: Pin },
    { label: t("admin.stats.avgChatsPerUser"), verdi: data.samtaler.snittPerBruker, ikon: BarChart3 },
    { label: t("admin.stats.activeShareLinks"), verdi: data.deling.aktiveLenker, ikon: Share2 },
    { label: t("admin.stats.inactiveShareLinks"), verdi: data.deling.inaktiveLenker, ikon: Share2 },
    { label: t("admin.stats.expiredShareLinks"), verdi: data.deling.utlopteLenker, ikon: Clock3 },
    { label: t("admin.stats.shareLinksWithViews"), verdi: data.deling.lenkerMedVisninger, ikon: Eye },
    { label: t("admin.stats.shareViewsTotal"), verdi: data.deling.visningerTotalt, ikon: Eye },
  ];

  const planStats: StatKortData[] = [
    { label: t("admin.stats.totalTasks"), verdi: data.oppgaver.oppgaveoppdelinger, ikon: BarChart3 },
    { label: t("admin.stats.totalSubtasks"), verdi: data.oppgaver.deloppgaverTotalt, ikon: BarChart3 },
    { label: t("admin.stats.completedSubtasks"), verdi: data.oppgaver.fullforteDeloppgaver, ikon: CheckCircle2 },
    { label: t("admin.stats.approvedSubtasks"), verdi: data.oppgaver.godkjenteDeloppgaver, ikon: CheckCircle2 },
    { label: t("admin.stats.avgSubtasksPerBreakdown"), verdi: data.oppgaver.snittDeloppgaverPerOppdeling, ikon: BarChart3 },
    { label: t("admin.stats.workPlans"), verdi: data.arbeidsplan.planer, ikon: CalendarDays },
    { label: t("admin.stats.workPlanBlocks"), verdi: data.arbeidsplan.blokkerTotalt, ikon: CalendarDays },
    { label: t("admin.stats.completedWorkPlanBlocks"), verdi: data.arbeidsplan.fullforteBlokker, ikon: CheckCircle2 },
    { label: t("admin.stats.usersWithWorkPlan"), verdi: data.arbeidsplan.brukereMedPlan, ikon: Users },
    { label: t("admin.stats.workPlanCompletionRate"), verdi: data.arbeidsplan.fullforingsgrad, ikon: BarChart3, format: "percent" },
  ];

  const innholdsStats: StatKortData[] = [
    { label: t("admin.stats.totalEmbeddings"), verdi: data.innhold.dokumentfragmenter, ikon: Database },
    { label: t("admin.stats.documentFiles"), verdi: data.innhold.dokumentfiler, ikon: FileText },
    { label: t("admin.stats.documentCourses"), verdi: data.innhold.dokumentemner, ikon: BookOpen },
    { label: t("admin.stats.usersWithContent"), verdi: data.innhold.brukereMedInnhold, ikon: Users },
    { label: t("admin.stats.totalTokens"), verdi: data.innhold.tokensTotalt, ikon: Database },
    { label: t("admin.stats.avgChunksPerFile"), verdi: data.innhold.snittChunksPerFil, ikon: BarChart3 },
    { label: t("admin.stats.cachedCourseStructures"), verdi: data.innhold.kursstrukturer, ikon: BookOpen },
    { label: t("admin.stats.cachedCanvasAssignments"), verdi: data.innhold.canvasOppgaver, ikon: ScrollText },
    { label: t("admin.stats.cachedCanvasAnnouncements"), verdi: data.innhold.canvasKunngjoringer, ikon: ScrollText },
    { label: t("admin.stats.cachedCanvasModules"), verdi: data.innhold.canvasModuler, ikon: BookOpen },
    { label: t("admin.stats.cachedCanvasModuleItems"), verdi: data.innhold.canvasModulElementer, ikon: FileText },
  ];

  const syncStats: StatKortData[] = [
    { label: t("admin.stats.usersWithSyncData"), verdi: data.sync.brukereMedSyncData, ikon: RefreshCcw },
    { label: t("admin.stats.usersWithFreshSync24h"), verdi: data.sync.brukereMedFerskSync24t, ikon: RefreshCcw },
    { label: t("admin.stats.usersWithStaleSync7d"), verdi: data.sync.brukereMedGammelSync7d, ikon: Clock3 },
    { label: t("admin.stats.canvasUsersWithoutSync"), verdi: data.sync.canvasBrukereUtenSyncData, ikon: AlertTriangle },
  ];

  const varslerStats: StatKortData[] = [
    { label: t("admin.stats.pushSubscriptions"), verdi: data.varsler.pushAbonnementer, ikon: Bell },
    { label: t("admin.stats.usersWithPush"), verdi: data.varsler.brukereMedPush, ikon: Users },
    { label: t("admin.stats.avgDevicesPerUser"), verdi: data.varsler.snittEnheterPerBruker, ikon: BarChart3 },
    { label: t("admin.stats.usersWithNotion"), verdi: data.integrasjoner.brukereMedNotion, ikon: FileUp },
  ];

  const revisjonsStats: StatKortData[] = [
    { label: t("admin.stats.auditEventsTotal"), verdi: data.revisjon.hendelserTotalt, ikon: Activity },
    { label: t("admin.stats.auditFailuresTotal"), verdi: data.revisjon.feilTotalt, ikon: AlertTriangle },
    { label: t("admin.stats.auditEvents24h"), verdi: data.revisjon.hendelser24t, ikon: Activity },
    { label: t("admin.stats.auditFailures24h"), verdi: data.revisjon.feil24t, ikon: AlertTriangle },
    { label: t("admin.stats.adminEvents24h"), verdi: data.revisjon.admin24t, ikon: Shield },
    { label: t("admin.stats.authEvents24h"), verdi: data.revisjon.auth24t, ikon: Shield },
    { label: t("admin.stats.integrationEvents24h"), verdi: data.revisjon.integration24t, ikon: Link },
    { label: t("admin.stats.aiEvents24h"), verdi: data.revisjon.ki24t, ikon: BarChart3 },
    { label: t("admin.stats.privacyEvents24h"), verdi: data.revisjon.privacy24t, ikon: Shield },
    { label: t("admin.stats.profileEvents24h"), verdi: data.revisjon.profile24t, ikon: Users },
    { label: t("admin.stats.securityEvents24h"), verdi: data.revisjon.security24t, ikon: ShieldCheck },
  ];

  const kvalitetsStats: StatKortData[] = [
    { label: t("admin.stats.orphanedChats"), verdi: data.kvalitet.orphanedSamtaler, ikon: AlertTriangle },
    { label: t("admin.stats.orphanedTaskBreakdowns"), verdi: data.kvalitet.orphanedOppgaveoppdelinger, ikon: AlertTriangle },
    { label: t("admin.stats.orphanedDocumentChunks"), verdi: data.kvalitet.orphanedDokumentfragmenter, ikon: Database },
    { label: t("admin.stats.orphanedWorkPlans"), verdi: data.kvalitet.orphanedArbeidsplaner, ikon: CalendarDays },
    { label: t("admin.stats.orphanedCanvasStructures"), verdi: data.kvalitet.orphanedCanvasStrukturer, ikon: BookOpen },
    { label: t("admin.stats.orphanedCanvasUsers"), verdi: data.kvalitet.orphanedCanvasBrukere, ikon: UserX },
    { label: t("admin.stats.ownerlessShareLinks"), verdi: data.kvalitet.delingerUtenEier, ikon: Share2 },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("admin.stats.note")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://fb26zl.grafana.net/d/fbrdskw/studywize-observability?orgId=1&from=now-24h&to=now&timezone=browser"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Grafana
            <ExternalLink size={14} />
          </a>
          <a
            href="https://us5.datadoghq.com/help/quick_start?tab=infrastructure"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Datadog
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      <StatSeksjon title={t("admin.stats.sections.users")} stats={brukerStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.conversations")} stats={samtaleStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.planning")} stats={planStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.content")} stats={innholdsStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.notifications")} stats={varslerStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.sync")} stats={syncStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.audit")} stats={revisjonsStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.quality")} stats={kvalitetsStats} language={language} />
    </div>
  );
}

// ── Observability-fane ───────────────────────────────────────────────────────

function ObservabilityFane() {
  const { language, t } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<LangsmithStatusFilter>("all");
  const [intentFilter, setIntentFilter] = useState("");
  const [runPage, setRunPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const limit = 20;

  const dailyQuery = useDailyMetrics();
  const dailyLoading = dailyQuery.isLoading;
  const dailyError = !!dailyQuery.error;
  const dailyMetrics = dailyQuery.data ?? [];
  const sisteDognLatency = dailyMetrics.at(-1)?.avgLatencyMs ?? null;
  const hoyesteLatency =
    dailyMetrics.length > 0
      ? Math.max(...dailyMetrics.map((entry: { avgLatencyMs: number }) => entry.avgLatencyMs))
      : null;

  const overviewQuery = useLangsmithOverview();
  const overviewLoading = overviewQuery.isLoading;
  const overviewError = !!overviewQuery.error;
  const overviewData = overviewQuery.data;
  const observabilityStats: StatKortData[] = [
    { label: t("admin.stats.aiObservability.totalRuns24h"), verdi: overviewData?.totalRuns24h ?? 0, ikon: Activity },
    { label: t("admin.stats.aiObservability.totalRuns7d"), verdi: overviewData?.totalRuns7d ?? 0, ikon: Activity },
  ];

  const runsQuery = useRuns(runPage, statusFilter, intentFilter);
  const runsLoading = runsQuery.isLoading;
  const runsError = !!runsQuery.error;
  const runsData = runsQuery.data;
  const runsTotalPages = runsData ? Math.max(1, Math.ceil(runsData.total / limit)) : 1;

  const runDetailQuery = useRunDetail(selectedRunId ?? null);
  const runDetailLoading = runDetailQuery.isLoading;
  const runDetailError = !!runDetailQuery.error;
  const runDetail = runDetailQuery.data;

  const clearCacheMutation = useClearLangsmithCache();

  if (overviewLoading && !overviewData) {
    return <LoadingSpinner />;
  }

  if (overviewError && !overviewData) {
    return <FeilMelding melding={t("admin.stats.aiObservability.loadFailed")} />;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.stats.sections.observability")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => clearCacheMutation.mutate()}
            disabled={clearCacheMutation.isPending}
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={14} className={clearCacheMutation.isPending ? "animate-spin" : ""} />
            {t("admin.stats.aiObservability.clearCache")}
          </button>
          <a
            href="https://smith.langchain.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            LangSmith
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <div className="space-y-4">
        <StatSeksjon title={t("admin.stats.aiObservability.cardsTitle")} stats={observabilityStats} language={language} />

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("admin.stats.aiObservability.overviewLineRuns", {
            runs24h: formaterTall(overviewData?.totalRuns24h ?? 0, language),
            runs7d: formaterTall(overviewData?.totalRuns7d ?? 0, language),
          })}
        </p>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.latencySummaryTitle")}
          </p>
          {dailyLoading || overviewLoading ? (
            <LoadingSpinner />
          ) : dailyError || overviewError ? (
            <FeilMelding melding={t("admin.stats.aiObservability.loadFailed")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyAverageLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {formaterTall(overviewData?.avgLatencyMs ?? 0, language)} ms
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyLatestLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {sisteDognLatency != null ? `${formaterTall(sisteDognLatency, language)} ms` : "–"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyPeakLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {hoyesteLatency != null ? `${formaterTall(hoyesteLatency, language)} ms` : "–"}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.tracingTableTitle")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => {
                const value = event.target.value as LangsmithStatusFilter;
                setStatusFilter(value);
                setRunPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base sm:text-sm text-slate-700 dark:text-slate-200"
            >
              <option value="all">{t("admin.stats.aiObservability.filters.statusAll")}</option>
              <option value="success">{t("admin.stats.aiObservability.filters.statusSuccess")}</option>
              <option value="error">{t("admin.stats.aiObservability.filters.statusError")}</option>
            </select>
            <input
              type="text"
              value={intentFilter}
              onChange={(event) => {
                setIntentFilter(event.target.value);
                setRunPage(1);
              }}
              placeholder={t("admin.stats.aiObservability.filters.intentPlaceholder")}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base sm:text-sm text-slate-700 dark:text-slate-200"
            />
          </div>

          {runsLoading ? (
            <LoadingSpinner />
          ) : runsError ? (
            <FeilMelding melding={t("admin.stats.aiObservability.runsLoadFailed")} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-160 text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">{t("admin.stats.aiObservability.table.timestamp")}</th>
                      <th className="px-3 py-2 text-left">{t("admin.stats.aiObservability.table.model")}</th>
                      <th className="px-3 py-2 text-left">{t("admin.stats.aiObservability.table.intent")}</th>
                      <th className="px-3 py-2 text-right">{t("admin.stats.aiObservability.table.tokens")}</th>
                      <th className="px-3 py-2 text-right">{t("admin.stats.aiObservability.table.latency")}</th>
                      <th className="px-3 py-2 text-left">{t("admin.stats.aiObservability.table.status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {runsData && runsData.runs.length > 0 ? (
                      runsData.runs.map((run: LangsmithRunRow) => (
                        <tr
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className="cursor-pointer bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {formaterDatoOgTid(run.timestamp, language)}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{run.model}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{run.intent}</td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                            {formaterTall(run.totalTokens, language)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                            {formaterTall(run.latencyMs, language)} ms
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                run.status === "success"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                          {t("admin.stats.aiObservability.table.noRuns")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {runsData && runsData.total > 0 && (
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {t("admin.stats.aiObservability.table.totalRuns", { total: formaterTall(runsData.total, language) })}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRunPage((prev) => Math.max(1, prev - 1))}
                      disabled={runPage <= 1}
                      className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 disabled:opacity-50"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>
                      {t("admin.stats.aiObservability.table.pageLabel", {
                        page: formaterTall(runPage, language),
                        totalPages: formaterTall(runsTotalPages, language),
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRunPage((prev) => Math.min(runsTotalPages, prev + 1))}
                      disabled={runPage >= runsTotalPages}
                      className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 disabled:opacity-50"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.detailsTitle")}
          </p>
          {!selectedRunId && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("admin.stats.aiObservability.detailsHint")}
            </p>
          )}
          {selectedRunId && runDetailLoading && <LoadingSpinner />}
          {selectedRunId && runDetailError && <FeilMelding melding={t("admin.stats.aiObservability.runDetailLoadFailed")} />}
          {selectedRunId && runDetail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">{t("admin.stats.aiObservability.detail.input")}</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.inputTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">{t("admin.stats.aiObservability.detail.output")}</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.outputTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">{t("admin.stats.aiObservability.detail.total")}</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.totalTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">{t("admin.stats.aiObservability.detail.latency")}</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.latencyMs, language)} ms
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.systemPrompt")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.systemPromptPreview || "—"}
                </pre>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.userPrompt")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.promptPreview || "—"}
                </pre>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.outputPreview")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.outputPreview || "—"}
                </pre>
              </div>
              {runDetail.errorMessage && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                  {runDetail.errorMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Brukere-fane ────────────────────────────────────────────────────────────

function BrukereFane() {
  const { language, t } = useLanguage();
  const megQuery = useMeg();
  const minId = megQuery.data?.user?.id;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Enkel debounce
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setOffset(0);
    }, 400);
  };

  const { data, isLoading, error } = useAdminBrukere({ limit, offset, search: debouncedSearch || undefined });
  const endreRolle = useEndreRolle();
  const slettBruker = useSlettBruker();

  const [bekreftSlett, setBekreftSlett] = useState<string | null>(null);

  const handleEndreRolle = (bruker: AdminBruker) => {
    if (bruker.id === minId) {
      showToast.error(t("admin.users.cannotChangeSelf"));
      return;
    }
    const nyRolle = bruker.rolle === "admin" ? "user" : "admin";
    endreRolle.mutate(
      { brukerId: bruker.id, rolle: nyRolle },
      {
        onSuccess: () => showToast.success(t("admin.users.roleChanged")),
        onError: (err) => showToast.error(err instanceof Error ? err.message : t("admin.errors.roleChangeFailed")),
      },
    );
  };

  const handleSlett = (brukerId: string) => {
    if (brukerId === minId) {
      showToast.error(t("admin.users.cannotDeleteSelf"));
      return;
    }
    slettBruker.mutate(brukerId, {
      onSuccess: (result) => {
        if (result.providerAccountDeleted && result.vectorCleanupSucceeded) {
          showToast.success(t("admin.users.userDeleted"));
        } else {
          showToast.warning(
            t("admin.users.userDeleted"),
            t("admin.users.userDeletedPartial"),
          );
        }
        setBekreftSlett(null);
      },
      onError: (err) => showToast.error(err instanceof Error ? err.message : t("admin.errors.deleteFailed")),
    });
  };

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;

  return (
    <div className="space-y-4">
      {/* Søk */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          aria-label={t("admin.users.searchPlaceholder")}
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <FeilMelding melding={t("admin.errors.usersFailed")} />}

      {data && (
        <>
          {/* Tabell */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-180 text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t("admin.users.email")}</th>
                  <th className="px-4 py-3">{t("admin.users.name")}</th>
                  <th className="px-4 py-3">{t("admin.users.role")}</th>
                  <th className="px-4 py-3">{t("admin.users.canvas")}</th>
                  <th className="px-4 py-3">{t("admin.users.provider")}</th>
                  <th className="px-4 py-3">{t("admin.users.created")}</th>
                  <th className="px-4 py-3">{t("admin.users.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.brukere.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      {t("admin.users.noUsers")}
                    </td>
                  </tr>
                ) : (
                  data.brukere.map((bruker) => {
                    const erDeg = bruker.id === minId;
                    return (
                      <tr key={bruker.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3 text-slate-900 dark:text-white">
                          {bruker.email}
                          {erDeg && (
                            <span className="ml-1.5 text-xs text-sky-600 dark:text-sky-400 font-medium">
                              {t("admin.users.you")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {[bruker.fornavn, bruker.etternavn].filter(Boolean).join(" ") || bruker.brukernavn || "–"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              bruker.rolle === "admin"
                                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {bruker.rolle === "admin" && <Shield size={12} />}
                            {bruker.rolle}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {bruker.harCanvasToken ? (
                            <Check size={16} className="text-green-500" />
                          ) : (
                            <X size={16} className="text-slate-300 dark:text-slate-600" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 capitalize">
                            {bruker.authProviders && bruker.authProviders.length > 0
                              ? bruker.authProviders.join(", ")
                              : "–"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formaterDatoLong(bruker.opprettet, language)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!erDeg && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEndreRolle(bruker)}
                                  disabled={endreRolle.isPending}
                                  title={t("admin.users.changeRole")}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-sky-600 dark:hover:text-sky-400 transition-colors disabled:opacity-50"
                                >
                                  <ShieldCheck size={16} />
                                </button>
                                {bekreftSlett === bruker.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                      {t("admin.users.deleteConfirm")}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleSlett(bruker.id)}
                                      disabled={slettBruker.isPending}
                                      aria-label={t("admin.users.deleteUser")}
                                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBekreftSlett(null)}
                                      aria-label={t("common.actions.cancel")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setBekreftSlett(bruker.id)}
                                    title={t("admin.users.deleteUser")}
                                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginering */}
          {total > limit && (
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
              <span>
                {offset + 1}–{Math.min(offset + limit, total)} / {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  disabled={!harForrige}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + limit)}
                  disabled={!harNeste}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Revisjonslogg-fane ──────────────────────────────────────────────────────

function RevisjonsloggFane() {
  const { language, t } = useLanguage();
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading, error } = useAdminAudit({ limit, offset });

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <FeilMelding melding={t("admin.errors.auditFailed")} />;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3">{t("admin.audit.action")}</th>
              <th className="px-4 py-3">{t("admin.audit.category")}</th>
              <th className="px-4 py-3">{t("admin.audit.outcome")}</th>
              <th className="px-4 py-3">{t("admin.audit.actor")}</th>
              <th className="px-4 py-3">{t("admin.audit.time")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {(!data || data.items.length === 0) ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                  {t("admin.audit.noEntries")}
                </td>
              </tr>
            ) : (
              data.items.map((item) => (
                <tr key={item.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-slate-900 dark:text-white font-mono text-xs">
                    {item.action}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        item.outcome === "success"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {item.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs truncate max-w-30">
                    {item.actorUserId}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formaterDatoOgTid(item.createdAt, language)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {offset + 1}–{Math.min(offset + limit, total)} / {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={!harForrige}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + limit)}
              disabled={!harNeste}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feedback-fane ──────────────────────────────────────────────────────────
type FeedbackItem = {
  id: string;
  rating: "up" | "down";
  question?: string;
  answer?: string;
  comment?: string;
  createdAt: string;
  user: { id: string; email?: string; username?: string } | null;
};

function FeedbackFane() {
  const { t } = useLanguage();
  const [rating, setRating] = useState<"up" | "down">("down");
  const [data, setData] = useState<{ totals: { up: number; down: number }; items: FeedbackItem[] } | null>(null);
  const [laster, setLaster] = useState(false);

  useEffect(() => {
    setLaster(true);
    fetchApi(`/api/admin/feedback?rating=${rating}&limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLaster(false));
  }, [rating]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["down", "up"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRating(r)}
            className={`px-3 py-1 rounded-lg text-sm border ${rating === r ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
          >
            {r === "down" ? t("admin.feedback.bad") : t("admin.feedback.good")}
            {data ? ` (${data.totals[r]})` : ""}
          </button>
        ))}
      </div>

      {laster && <p className="text-sm text-slate-500">…</p>}

      {data && data.items.length === 0 && !laster && (
        <p className="text-sm text-slate-500 italic">{t("admin.feedback.empty")}</p>
      )}

      <ul className="space-y-3">
        {data?.items.map((it) => (
          <li
            key={it.id}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>{it.user?.email ?? it.user?.username ?? "—"}</span>
              <span>{new Date(it.createdAt).toLocaleString()}</span>
            </div>
            {it.question && (
              <p className="text-sm text-slate-700 dark:text-slate-300 mb-1">
                <span className="font-semibold">Q:</span> {it.question}
              </p>
            )}
            {it.answer && (
              <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-4">
                <span className="font-semibold">A:</span> {it.answer}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Hovedkomponent ──────────────────────────────────────────────────────────

const FANER: {
  id: AdminFane;
  ikon: React.ElementType;
  labelKey: "admin.tabs.stats" | "admin.tabs.observability" | "admin.tabs.users" | "admin.tabs.audit" | "admin.tabs.feedback";
}[] = [
  { id: "stats", ikon: BarChart3, labelKey: "admin.tabs.stats" },
  { id: "observability", ikon: Activity, labelKey: "admin.tabs.observability" },
  { id: "users", ikon: Users, labelKey: "admin.tabs.users" },
  { id: "audit", ikon: ScrollText, labelKey: "admin.tabs.audit" },
  { id: "feedback", ikon: AlertTriangle, labelKey: "admin.tabs.feedback" },
];

export function AdminSection() {
  const { t } = useLanguage();
  const [aktivFane, setAktivFane] = useState<AdminFane>("stats");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Shield size={20} className="text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
          {t("admin.title")}
        </h1>
      </div>

      {/* Faner */}
      <div role="tablist" aria-label={t("admin.title")} className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
        {FANER.map(({ id, ikon: Ikon, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktivFane === id}
            aria-controls={`admin-tabpanel-${id}`}
            id={`admin-tab-${id}`}
            onClick={() => setAktivFane(id)}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
              aktivFane === id
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Ikon size={16} className="shrink-0" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Innhold */}
      <div role="tabpanel" id={`admin-tabpanel-${aktivFane}`} aria-labelledby={`admin-tab-${aktivFane}`}>
        {aktivFane === "stats" && <StatistikkFane />}
        {aktivFane === "observability" && <ObservabilityFane />}
        {aktivFane === "users" && <BrukereFane />}
        {aktivFane === "audit" && <RevisjonsloggFane />}
        {aktivFane === "feedback" && <FeedbackFane />}
      </div>
    </div>
  );
}

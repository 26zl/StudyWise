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
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { useMeg } from "@/app/auth/auth-api";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { showToast } from "@/app/components/ui/Toaster";
import { formaterDatoLong, formaterDatoOgTid, formaterTall } from "@/app/lib/dato";
import {
  useAdminStats,
  useAdminBrukere,
  useAdminAudit,
  useEndreRolle,
  useSlettBruker,
} from "@/app/admin/admin-api";
import type { AdminBruker } from "@/app/admin/admin-api";

type AdminFane = "stats" | "users" | "audit";

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
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("admin.stats.note")}
      </p>
      <StatSeksjon title={t("admin.stats.sections.users")} stats={brukerStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.conversations")} stats={samtaleStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.planning")} stats={planStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.content")} stats={innholdsStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.sync")} stats={syncStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.audit")} stats={revisjonsStats} language={language} />
      <StatSeksjon title={t("admin.stats.sections.quality")} stats={kvalitetsStats} language={language} />
    </div>
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
        onError: (err) => showToast.error(err instanceof Error ? err.message : "Feil"),
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
      onError: (err) => showToast.error(err instanceof Error ? err.message : "Feil"),
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
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <FeilMelding melding={t("admin.errors.usersFailed")} />}

      {data && (
        <>
          {/* Tabell */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
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
                          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 capitalize">
                            {bruker.authProvider ?? "–"}
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
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleSlett(bruker.id)}
                                      disabled={slettBruker.isPending}
                                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBekreftSlett(null)}
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

// ── Hovedkomponent ──────────────────────────────────────────────────────────

const FANER: { id: AdminFane; ikon: React.ElementType; labelKey: "admin.tabs.stats" | "admin.tabs.users" | "admin.tabs.audit" }[] = [
  { id: "stats", ikon: BarChart3, labelKey: "admin.tabs.stats" },
  { id: "users", ikon: Users, labelKey: "admin.tabs.users" },
  { id: "audit", ikon: ScrollText, labelKey: "admin.tabs.audit" },
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
        {aktivFane === "users" && <BrukereFane />}
        {aktivFane === "audit" && <RevisjonsloggFane />}
      </div>
    </div>
  );
}

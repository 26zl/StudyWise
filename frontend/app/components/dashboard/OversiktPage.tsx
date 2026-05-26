/**
 * OversiktPage – oversiktsside med mine oppgaver (Canvas-frister), KI-forslag og hurtiglenker.
 * Bruker SidebarAppShell og støtter auth-redirect og Canvas-tilgang.
 */
"use client";

import { useCallback, useEffect, useMemo } from "react";
import Link from "next/link";

import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  History,
  Library,
  Megaphone,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { MinArbeidsplan } from "@/app/components/arbeidsplan/MinArbeidsplan";
import { WeeklyPlanSuggestions } from "@/app/components/arbeidsplan/WeeklyPlanSuggestions";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { StatCard } from "@/app/components/ui/StatCard";
import { useAuth } from "@clerk/nextjs";
import { useMeg, useHiddenCourseIds } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect, useFatalAuthSignOut } from "@/app/auth/authUtils";
import {
  useCanvasAllAssignments,
  useCanvasCourses,
  type AssignmentMedEmne,
} from "@/app/canvas/canvas-api";
import { erInnlevert } from "@/app/canvas/canvasUtils";
import { useManuellInnlevering } from "@/app/hooks/useManuellInnlevering";
import {
  dagerFraIdag,
  formaterDatoFull,
  formaterDatoShort,
  formaterDagerRelativtFrist,
} from "@/app/lib/dato";
import { getBrukerdataFeilmelding, lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { erInnenforFristVindu, FRIST_VINDU_DAGER } from "@/app/lib/varsler";
import { useLanguage, type Translator } from "@/app/i18n";
import { fetchApi } from "@/app/lib/apiClient";
import { useProgressStats } from "@/app/arbeidsplan/arbeidsplan-api";

// Studiestatistikk
interface StudyStatsToday {
  chatSessions: number;
  tasksCompleted: number;
  studyBlocksCompleted: number;
  studyHoursCompleted: number;
  topicsStudied: number;
}

async function fetchStudyStatsToday(): Promise<StudyStatsToday> {
  const res = await fetchApi("/api/user/study-stats/today", { method: "GET" });
  if (!res.ok) throw new Error("Kunne ikke hente studiestatistikk");
  return res.json();
}

function useStudyStatsToday(enabled: boolean) {
  return useQuery({
    queryKey: ["study-stats", "today"],
    queryFn: fetchStudyStatsToday,
    enabled,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  });
}

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  color:
    | "blue"
    | "green"
    | "purple"
    | "amber"
    | "rose"
    | "teal"
    | "indigo"
    | "pink"
    | "cyan"
    | "orange"
    | "emerald";
}

type OversiktTab = "mine-oppgaver" | "ki-forslag";

export function OversiktPage() {
  const { language, t } = useLanguage();
  // clearOnDefault: false holder `?tab=mine-oppgaver` synlig også for default-fanen,
  // slik at valgt fane alltid er dyplinkbar. history: "replace" hindrer at hvert
  // fanebytte forurenser nettleserens back-stack.
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral(["mine-oppgaver", "ki-forslag"] as const)
      .withDefault("mine-oppgaver")
      .withOptions({ clearOnDefault: false, history: "replace" }),
  );

  const byttTab = useCallback(
    (nesteTab: OversiktTab) => {
      void setActiveTab(nesteTab, { history: "replace", scroll: false });
    },
    [setActiveTab],
  );

  // Skriv aktiv tab til URL ved første besøk slik at valgt fane vises i URL-en.
  useEffect(() => {
    void setActiveTab(activeTab, { history: "replace", scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { isLoaded: clerkLoaded, userId: clerkUserId } = useAuth();
  const megQuery = useMeg({ enabled: clerkLoaded && !!clerkUserId });
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;

  useAuthRedirect(megQuery);
  const erFatalAuthFeil = useFatalAuthSignOut(megQuery);

  const coursesQuery = useCanvasCourses(harCanvasToken);
  const hiddenSet = useHiddenCourseIds();
  const assignmentsQuery = useCanvasAllAssignments({
    enabled: harCanvasToken,
    courses: coursesQuery.data?.courses,
  });

  const studyStatsQuery = useStudyStatsToday(megQuery.isSuccess);
  const progressQuery = useProgressStats(megQuery.isSuccess);

  const { ferdigeIdSet, toggleFerdig } = useManuellInnlevering();

  const allAssignments: AssignmentMedEmne[] = (
    assignmentsQuery.isError ? [] : (assignmentsQuery.data ?? [])
  ).filter((a) => !a.course_id || !hiddenSet.has(a.course_id));
  const ikkeInnleverteAssignments = allAssignments.filter(
    (assignment) => !erInnlevert(assignment) && !ferdigeIdSet.has(assignment.id),
  );

  const totalCourses = (coursesQuery.data?.courses ?? []).filter(
    (c) => !hiddenSet.has(c.id),
  ).length;

  const upcomingAssignments = ikkeInnleverteAssignments.filter((assignment) =>
    erInnenforFristVindu(assignment.due_at),
  );

  // Oppgaver du skylder inn — enten aldri levert eller ikke markert ferdig.
  // Den mest handlbare KPI-en for en student: viser etterslep uavhengig av frist.
  const ikkeInnleverteCount = ikkeInnleverteAssignments.length;

  // Fullførte oppgaver i inneværende år — positiv progresjons-signal.
  // Canvas-innlevert: bruker submission.submitted_at når datoen finnes og er i år.
  // Manuell innlevering (ferdigeIdSet): ingen datostempel, så inkluderes som "nylig"
  // (heuristikk — useManuellInnlevering lagrer bare IDer, ikke timestamps).
  const fullforteIAr = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return allAssignments.filter((assignment) => {
      if (ferdigeIdSet.has(assignment.id)) return true;
      if (!erInnlevert(assignment)) return false;
      const submittedAt = assignment.submission?.submitted_at;
      if (!submittedAt) return false;
      const year = new Date(submittedAt).getFullYear();
      return year === currentYear;
    }).length;
  }, [allAssignments, ferdigeIdSet]);

  const handlePlanCreated = () => {
    byttTab("mine-oppgaver");
  };

  const brukerdataFeilmelding = getBrukerdataFeilmelding(megQuery.error, t);

  const oppgaveFeilmelding = lagBrukervennligFeilmelding(
    assignmentsQuery.error instanceof Error ? assignmentsQuery.error : null,
    { canvas: true },
    t("errors.generic.default"),
    t,
  );

  const handleOverviewTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

      event.preventDefault();
      byttTab(activeTab === "mine-oppgaver" ? "ki-forslag" : "mine-oppgaver");
    },
    [activeTab, byttTab],
  );

  if (megQuery.isPending) {
    return <LoadingView text={t("common.loading.overview")} />;
  }

  if (skalRedirecteTilAuth(megQuery) || erFatalAuthFeil) {
    const label = skalRedirecteTilAuth(megQuery)
      ? t("common.loading.redirectingToSignIn")
      : t("common.loading.generic");
    return <LoadingView text={label} />;
  }

  if (megQuery.isError && !megQuery.data?.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-4">
        <FeilMelding melding={brukerdataFeilmelding} />
        <button
          type="button"
          onClick={() => {
            void megQuery.refetch();
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                {t("overview.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("overview.pageDescription")}
              </p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                {formaterDatoFull(new Date(), language)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href="/dashboard"
                prefetch={false}
                aria-label={t("overview.openChat")}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 sm:px-4 sm:py-2"
              >
                <MessageSquare size={18} />
                <span className="hidden sm:inline">{t("overview.openChat")}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {!harCanvasToken && <CanvasTokenNotice />}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard
            icon={BookOpen}
            label={t("overview.stats.totalCourses")}
            value={totalCourses}
            color="blue"
          />
          <StatCard
            icon={Clock}
            label={t("overview.stats.upcomingDeadlines")}
            value={assignmentsQuery.isError ? "—" : upcomingAssignments.length}
            color="yellow"
          />
          <StatCard
            icon={AlertCircle}
            label={t("overview.stats.notSubmitted")}
            value={assignmentsQuery.isError ? "—" : ikkeInnleverteCount}
            color="slate"
          />
          <StatCard
            icon={TrendingUp}
            label={t("overview.stats.completedThisYear")}
            value={assignmentsQuery.isError ? "—" : fullforteIAr}
            color="green"
          />
        </div>

        <StudyActivityCard
          stats={studyStatsQuery.data}
          progress={progressQuery.data}
          isLoading={studyStatsQuery.isLoading}
          t={t}
        />

        <div className="rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex gap-1" role="tablist" aria-label={t("overview.tabs.ariaLabel")}>
            <button
              type="button"
              id="overview-tab-my-workplan"
              role="tab"
              aria-selected={activeTab === "mine-oppgaver"}
              aria-controls="overview-panel-my-workplan"
              aria-label={t("overview.tabs.myWorkPlan")}
              onClick={() => byttTab("mine-oppgaver")}
              onKeyDown={handleOverviewTabKeyDown}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "mine-oppgaver"
                  ? "bg-blue-600 text-white dark:bg-blue-500"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="h-4 w-4" aria-hidden />
                {t("overview.tabs.myWorkPlan")}
              </div>
            </button>
            <button
              type="button"
              id="overview-tab-ai-weekplan"
              role="tab"
              aria-selected={activeTab === "ki-forslag"}
              aria-controls="overview-panel-ai-weekplan"
              aria-label={t("overview.tabs.aiWeekPlan")}
              onClick={() => byttTab("ki-forslag")}
              onKeyDown={handleOverviewTabKeyDown}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "ki-forslag"
                  ? "bg-blue-600 text-white dark:bg-blue-500"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Sparkles className="h-4 w-4" aria-hidden />
                {t("overview.tabs.aiWeekPlan")}
              </div>
            </button>
          </div>
        </div>

        <div
          id="overview-panel-my-workplan"
          role="tabpanel"
          aria-labelledby="overview-tab-my-workplan"
          className={activeTab === "mine-oppgaver" ? "outline-none" : "hidden"}
        >
          <MinArbeidsplan />
        </div>

        <div
          id="overview-panel-ai-weekplan"
          role="tabpanel"
          aria-labelledby="overview-tab-ai-weekplan"
          className={activeTab === "ki-forslag" ? "outline-none" : "hidden"}
        >
          <div className="space-y-2">
            {!harCanvasToken ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800/50">
                <CanvasTokenNotice message={t("overview.missingCanvasPlanner")} />
              </div>
            ) : assignmentsQuery.isLoading ? (
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50 p-8">
                <LoadingView translationKey="common.loading.assignments" fullPage={false} />
              </div>
            ) : assignmentsQuery.isError ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800/50">
                <FeilMelding melding={oppgaveFeilmelding} />
              </div>
            ) : ikkeInnleverteAssignments.length > 0 ? (
              <WeeklyPlanSuggestions
                assignments={ikkeInnleverteAssignments.map((assignment) => ({
                  id: assignment.id.toString(),
                  name: assignment.name,
                  dueAt: assignment.due_at ? new Date(assignment.due_at) : undefined,
                  courseName: assignment.course_name,
                  pointsPossible: assignment.points_possible || undefined,
                }))}
                onPlanCreated={handlePlanCreated}
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                  <AlertCircle className="h-12 w-12 text-slate-400 dark:text-slate-500" />
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">
                      {t("overview.noAssignments.title")}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {t("overview.noAssignments.description")}
                    </p>
                  </div>
                  <Link
                    href="/dashboard?view=settings"
                    prefetch={false}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    {t("common.actions.goToSettings")}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t("overview.quickAccess.title")}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
            <QuickActionCard
              title={t("overview.quickActions.aiAssistant.title")}
              description={t("overview.quickActions.aiAssistant.description")}
              icon={MessageSquare}
              href="/dashboard"
              color="blue"
            />
            <QuickActionCard
              title={t("overview.quickActions.taskBreakdown.title")}
              description={t("overview.quickActions.taskBreakdown.description")}
              icon={Sparkles}
              href="/ai-breakdown"
              color="purple"
            />
            <QuickActionCard
              title={t("overview.quickActions.courses.title")}
              description={t("overview.quickActions.courses.description")}
              icon={BookOpen}
              href="/dashboard?view=canvas-courses"
              color="green"
            />
            <QuickActionCard
              title={t("overview.quickActions.chatHistory.title")}
              description={t("overview.quickActions.chatHistory.description")}
              icon={History}
              href="/dashboard/samtalehistorikk"
              color="indigo"
            />
            <QuickActionCard
              title={t("overview.quickActions.notifications.title")}
              description={t("overview.quickActions.notifications.description")}
              icon={Bell}
              href="/dashboard?view=varslinger"
              color="rose"
            />
            <QuickActionCard
              title={t("overview.quickActions.calendar.title")}
              description={t("overview.quickActions.calendar.description")}
              icon={Calendar}
              href="/dashboard?view=calendar"
              color="teal"
            />
            <QuickActionCard
              title={t("overview.quickActions.library.title")}
              description={t("overview.quickActions.library.description")}
              icon={Library}
              href="/dashboard/bokmerker"
              color="pink"
            />
            <QuickActionCard
              title={t("overview.quickActions.quizFlashcards.title")}
              description={t("overview.quickActions.quizFlashcards.description")}
              icon={Brain}
              href="/dashboard?view=quiz"
              color="cyan"
            />
            <QuickActionCard
              title={t("overview.quickActions.announcements.title")}
              description={t("overview.quickActions.announcements.description")}
              icon={Megaphone}
              href="/dashboard?view=canvas-announcements"
              color="orange"
            />
            <QuickActionCard
              title={t("overview.quickActions.assignments.title")}
              description={t("overview.quickActions.assignments.description")}
              icon={ClipboardList}
              href="/dashboard?view=canvas-assignments"
              color="emerald"
            />
          </div>
        </div>

        {upcomingAssignments.length > 0 ? (
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t("overview.upcomingDeadlines", { days: FRIST_VINDU_DAGER })}
            </h2>
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/50">
              {upcomingAssignments.slice(0, 5).map((assignment) => {
                const daysUntil = dagerFraIdag(assignment.due_at!);
                const isUrgent = daysUntil <= 2;

                return (
                  <div
                    key={assignment.id}
                    className="p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={false}
                          aria-label={t("notifications.markAsSubmitted")}
                          title={t("notifications.markAsSubmitted")}
                          onClick={() => toggleFerdig(assignment.id)}
                          className="mt-0.5 shrink-0 w-5 h-5 rounded border-2 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium text-slate-900 dark:text-white">
                            {assignment.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {assignment.course_name}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`text-sm font-medium ${
                            isUrgent
                              ? "text-red-600 dark:text-red-400"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {formaterDagerRelativtFrist(daysUntil, language)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formaterDatoShort(assignment.due_at!, language)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuickActionCard({ title, description, icon: Icon, href, color }: QuickActionCardProps) {
  const colorClasses = {
    blue: "border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/10 dark:hover:bg-blue-900/20",
    green:
      "border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/10 dark:hover:bg-green-900/20",
    purple:
      "border-purple-200 bg-purple-50 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/10 dark:hover:bg-purple-900/20",
    amber:
      "border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/10 dark:hover:bg-amber-900/20",
    rose: "border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/10 dark:hover:bg-rose-900/20",
    teal: "border-teal-200 bg-teal-50 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-900/10 dark:hover:bg-teal-900/20",
    indigo:
      "border-indigo-200 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/10 dark:hover:bg-indigo-900/20",
    pink: "border-pink-200 bg-pink-50 hover:bg-pink-100 dark:border-pink-800 dark:bg-pink-900/10 dark:hover:bg-pink-900/20",
    cyan: "border-cyan-200 bg-cyan-50 hover:bg-cyan-100 dark:border-cyan-800 dark:bg-cyan-900/10 dark:hover:bg-cyan-900/20",
    orange:
      "border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/10 dark:hover:bg-orange-900/20",
    emerald:
      "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20",
  };

  const iconColorClasses = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    purple: "text-purple-600 dark:text-purple-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    teal: "text-teal-600 dark:text-teal-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    pink: "text-pink-600 dark:text-pink-400",
    cyan: "text-cyan-600 dark:text-cyan-400",
    orange: "text-orange-600 dark:text-orange-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  };

  return (
    <Link
      href={href}
      prefetch={false}
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${colorClasses[color]}`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/70 dark:bg-slate-900/40 ${iconColorClasses[color]}`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="truncate text-xs text-slate-600 dark:text-slate-400">{description}</p>
      </div>
    </Link>
  );
}

// Studieaktivitetskort
interface ActivityItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number | string;
  color: string;
}

function ActivityItem({ icon: Icon, label, value, color }: ActivityItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function StudyActivityCard({
  stats,
  progress,
  isLoading,
  t,
}: {
  stats: StudyStatsToday | undefined;
  progress: import("common/arbeidsplan").ArbeidsplanProgress | undefined;
  isLoading: boolean;
  t: Translator;
}) {
  const hasAnyActivity =
    stats &&
    (stats.chatSessions > 0 ||
      stats.tasksCompleted > 0 ||
      stats.studyBlocksCompleted > 0 ||
      stats.studyHoursCompleted > 0 ||
      stats.topicsStudied > 0);

  const percentage = progress?.percentage ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 size={20} className="text-blue-600 dark:text-blue-400" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("overview.studyActivity.title")}
        </h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        </div>
      ) : !hasAnyActivity ? (
        <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("overview.studyActivity.noActivity")}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <ActivityItem
              icon={MessageSquare}
              label={t("overview.studyActivity.chatSessions")}
              value={stats?.chatSessions ?? 0}
              color="bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
            />
            <ActivityItem
              icon={CheckCircle2}
              label={t("overview.studyActivity.tasksCompleted")}
              value={stats?.tasksCompleted ?? 0}
              color="bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400"
            />
            <ActivityItem
              icon={BookOpen}
              label={t("overview.studyActivity.studyBlocks")}
              value={stats?.studyBlocksCompleted ?? 0}
              color="bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400"
            />
            <ActivityItem
              icon={Clock}
              label={t("overview.studyActivity.activeTime")}
              value={`${stats?.studyHoursCompleted ?? 0} ${t("overview.studyActivity.hoursUnit")}`}
              color="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400"
            />
            <ActivityItem
              icon={Target}
              label={t("overview.studyActivity.topicsExplored")}
              value={stats?.topicsStudied ?? 0}
              color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            />
          </div>

          {progress && progress.totalBlocks > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  {percentage}% {t("overview.studyActivity.planProgress")}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {progress.completedBlocks}/{progress.totalBlocks}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-500"
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

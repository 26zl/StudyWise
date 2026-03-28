/**
 * OversiktPage – oversiktsside med mine oppgaver (Canvas-frister), KI-forslag og hurtiglenker.
 * Bruker SidebarAppShell og støtter auth-redirect og Canvas-tilgang.
 */
"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Clock,
  MessageSquare,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { MinArbeidsplan } from "@/app/components/arbeidsplan/MinArbeidsplan";
import { WeeklyPlanSuggestions } from "@/app/components/arbeidsplan/WeeklyPlanSuggestions";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { StatCard } from "@/app/components/ui/StatCard";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useMeg } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import {
  useCanvasAllAssignments,
  useCanvasCourses,
  useCanvasUser,
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
import {
  getBrukerdataFeilmelding,
  lagBrukervennligFeilmelding,
} from "@/app/lib/errorUtils";
import { erInnenforFristVindu, FRIST_VINDU_DAGER } from "@/app/lib/varsler";
import { useLanguage } from "@/app/i18n";

const SIDEBAR_VISNING: VisningType = "chat";

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  color: "blue" | "green" | "purple";
}

export function OversiktPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"mine-oppgaver" | "ki-forslag">(
    "mine-oppgaver",
  );
  const activeTabId =
    activeTab === "mine-oppgaver"
      ? "overview-tab-my-workplan"
      : "overview-tab-ai-weekplan";
  const activePanelId =
    activeTab === "mine-oppgaver"
      ? "overview-panel-my-workplan"
      : "overview-panel-ai-weekplan";

  const { isLoaded: clerkLoaded } = useAuth();
  const clerk = useClerk();
  const megQuery = useMeg({ enabled: clerkLoaded });
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);

  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")[0];
  const brukerRolle = megQuery.data?.user?.role;

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  useAuthRedirect(megQuery);

  const coursesQuery = useCanvasCourses(harCanvasToken);
  const assignmentsQuery = useCanvasAllAssignments({
    enabled: harCanvasToken,
    courses: coursesQuery.data?.courses,
  });

  const { ferdigeIdSet, toggleFerdig } = useManuellInnlevering();

  const allAssignments: AssignmentMedEmne[] = assignmentsQuery.isError
    ? []
    : assignmentsQuery.data ?? [];
  const ikkeInnleverteAssignments = allAssignments.filter(
    (assignment) => !erInnlevert(assignment) && !ferdigeIdSet.has(assignment.id),
  );

  const totalCourses = coursesQuery.data?.courses?.length || 0;
  const totalAssignments = allAssignments.length;

  const upcomingAssignments = ikkeInnleverteAssignments.filter((assignment) =>
    erInnenforFristVindu(assignment.due_at),
  );

  const activeCoursesCount = new Set(
    allAssignments
      .filter((assignment) => assignment.course_id != null)
      .map((assignment) => assignment.course_id),
  ).size;

  const handlePlanCreated = () => {
    setActiveTab("mine-oppgaver");
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
      setActiveTab((currentTab) =>
        currentTab === "mine-oppgaver" ? "ki-forslag" : "mine-oppgaver",
      );
    },
    [],
  );

  if (megQuery.isPending) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
        label={t("common.loading.overview")}
      />
    );
  }

  if (skalRedirecteTilAuth(megQuery)) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukerRolle={brukerRolle}
        label={t("common.loading.redirectingToSignIn")}
      />
    );
  }

  if (megQuery.isError && !megQuery.data?.user) {
    const feilMsg = megQuery.error?.message ?? "";
    const erFatalAuthFeil = /kontoen er slettet|innloggingskonflikt|allerede en konto/i.test(feilMsg);
    return (
      <SidebarAppErrorState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukerRolle={brukerRolle}
        message={brukerdataFeilmelding}
        onRetry={erFatalAuthFeil
          ? () => { void clerk.signOut({ redirectUrl: "/auth/sign-in" }); }
          : () => { void megQuery.refetch(); }
        }
      />
    );
  }

  return (
    <SidebarAppShell
      aktivVisning={SIDEBAR_VISNING}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      brukerRolle={brukerRolle}
    >
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                  {t("overview.title")}
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {formaterDatoFull(new Date(), language)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  <MessageSquare size={18} />
                  <span>{t("overview.openChat")}</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          {!harCanvasToken && (
            <CanvasTokenNotice />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              icon={BookOpen}
              label={t("overview.stats.activeCourses")}
              value={assignmentsQuery.isError ? "—" : activeCoursesCount}
              color="blue"
            />
            <StatCard
              icon={Clock}
              label={t("overview.stats.upcomingAssignments")}
              value={assignmentsQuery.isError ? "—" : upcomingAssignments.length}
              color="yellow"
            />
            <StatCard
              icon={TrendingUp}
              label={t("overview.stats.totalAssignments")}
              value={assignmentsQuery.isError ? "—" : totalAssignments}
              color="green"
            />
            <StatCard
              icon={Calendar}
              label={t("overview.stats.totalCourses")}
              value={totalCourses}
              color="purple"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex gap-1" role="tablist" aria-label={t("overview.tabs.ariaLabel")}>
              <button
                type="button"
                id="overview-tab-my-workplan"
                role="tab"
                aria-selected={activeTab === "mine-oppgaver"}
                aria-controls="overview-panel-my-workplan"
                aria-label={t("overview.tabs.myWorkPlan")}
                onClick={() => setActiveTab("mine-oppgaver")}
                onKeyDown={handleOverviewTabKeyDown}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "mine-oppgaver"
                    ? "bg-purple-600 text-white"
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
                onClick={() => setActiveTab("ki-forslag")}
                onKeyDown={handleOverviewTabKeyDown}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "ki-forslag"
                    ? "bg-purple-600 text-white"
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
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={activeTabId}
            className="outline-none"
          >
            {activeTab === "mine-oppgaver" ? <MinArbeidsplan /> : null}

            {activeTab === "ki-forslag" ? (
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
                      dueAt: assignment.due_at
                        ? new Date(assignment.due_at)
                        : undefined,
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
            ) : null}
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t("overview.quickAccess.title")}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
    </SidebarAppShell>
  );
}

function QuickActionCard({
  title,
  description,
  icon: Icon,
  href,
  color,
}: QuickActionCardProps) {
  const colorClasses = {
    blue: "border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/10 dark:hover:bg-blue-900/20",
    green:
      "border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/10 dark:hover:bg-green-900/20",
    purple:
      "border-purple-200 bg-purple-50 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/10 dark:hover:bg-purple-900/20",
  };

  const iconColorClasses = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    purple: "text-purple-600 dark:text-purple-400",
  };

  return (
    <Link
      href={href}
      prefetch={false}
      className={`block rounded-xl border p-6 transition-colors ${colorClasses[color]}`}
    >
      <Icon size={24} className={`mb-3 ${iconColorClasses[color]}`} />
      <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
    </Link>
  );
}

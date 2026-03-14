/**
 * AIBreakdownPage – side for KI-oppgavedeling: velg en Canvas-oppgave og generer deloppgaver med KI.
 * Viser liste over aktive oppgaver, detaljer og AITaskBreakdown for valgt oppgave.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
} from "lucide-react";
import { AITaskBreakdown } from "@/app/components/ki/AITaskBreakdown";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { type VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { StatCard } from "@/app/components/ui/StatCard";
import { useMeg } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import {
  useCanvasAllAssignments,
  useCanvasUser,
  type AssignmentMedEmne,
} from "@/app/canvas/canvas-api";
import { erInnlevert } from "@/app/canvas/canvasUtils";
import { formaterDatoLong } from "@/app/lib/dato";
import {
  getBrukerdataFeilmelding,
  lagBrukervennligFeilmelding,
} from "@/app/lib/errorUtils";

const SIDEBAR_VISNING: VisningType = "chat";

function sorterOppgaver(oppgaver: AssignmentMedEmne[]): AssignmentMedEmne[] {
  return [...oppgaver].sort((a, b) => {
    if (!a.due_at && !b.due_at) {
      return a.name.localeCompare(b.name, "nb");
    }
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });
}

export function AIBreakdownPage() {
  const router = useRouter();
  const [expandedAssignmentIds, setExpandedAssignmentIds] = useState<Set<string>>(new Set());

  const megQuery = useMeg();
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);
  const assignmentsQuery = useCanvasAllAssignments({ enabled: harCanvasToken });

  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  useAuthRedirect(megQuery);

  const aktiveOppgaver = useMemo(
    () =>
      sorterOppgaver((assignmentsQuery.data ?? []).filter((assignment) => !erInnlevert(assignment))),
    [assignmentsQuery.data],
  );

  useEffect(() => {
    const gyldigeIds = new Set(aktiveOppgaver.map((assignment) => assignment.id.toString()));
    setExpandedAssignmentIds((current) => {
      const neste = new Set([...current].filter((id) => gyldigeIds.has(id)));
      if (neste.size === 0 && aktiveOppgaver.length > 0) {
        neste.add(aktiveOppgaver[0].id.toString());
      }
      return neste;
    });
  }, [aktiveOppgaver]);

  const oppgaverMedFrist = useMemo(
    () => aktiveOppgaver.filter((assignment) => Boolean(assignment.due_at)),
    [aktiveOppgaver],
  );
  const forsinkedeOppgaver = useMemo(
    () =>
      oppgaverMedFrist.filter(
        (assignment) => assignment.due_at != null && new Date(assignment.due_at).getTime() < Date.now(),
      ),
    [oppgaverMedFrist],
  );
  const oppgaverUtenFrist = aktiveOppgaver.length - oppgaverMedFrist.length;

  if (megQuery.isLoading) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        label="Laster oppgaver..."
      />
    );
  }

  if (skalRedirecteTilAuth(megQuery)) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        label="Sender deg til innlogging..."
      />
    );
  }

  if (megQuery.isError && !megQuery.data?.user) {
    const feilmelding = getBrukerdataFeilmelding(megQuery.error);
    return (
      <SidebarAppErrorState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        message={feilmelding}
        onRetry={() => {
          void megQuery.refetch();
        }}
      />
    );
  }

  return (
    <SidebarAppShell
      aktivVisning={SIDEBAR_VISNING}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
    >
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
          <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-linear-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white truncate">
                      Oppgavedeling med KI
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Bryt ned Canvas-oppgaver i konkrete deloppgaver
                    </p>
                  </div>
                </div>

                {aktiveOppgaver.length > 0 && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedAssignmentIds(new Set(aktiveOppgaver.map((assignment) => assignment.id.toString())))}
                      className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      Utvid alle
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedAssignmentIds(new Set())}
                      className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      Lukk alle
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard
                icon={BookOpen}
                label="Aktive oppgaver"
                value={aktiveOppgaver.length}
                color="blue"
              />
              <StatCard
                icon={CalendarClock}
                label="Med frist"
                value={oppgaverMedFrist.length}
                color="purple"
              />
              <StatCard
                icon={AlertCircle}
                label="Forsinket"
                value={forsinkedeOppgaver.length}
                color="yellow"
              />
              <StatCard
                icon={Clock}
                label="Uten frist"
                value={oppgaverUtenFrist}
                color="green"
              />
            </div>

            {!harCanvasToken && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-3">
                <FeilMelding melding="Du må knytte en Canvas API-token for å hente oppgaver og bruke oppgavedeling med KI. Gå til Innstillinger for å legge til token." />
                <Link
                  href="/dashboard?view=settings"
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Gå til innstillinger
                </Link>
              </div>
            )}

            {harCanvasToken && assignmentsQuery.isLoading && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-10">
                <LoadingView text="Laster oppgaver..." fullPage={false} />
              </div>
            )}

            {harCanvasToken && assignmentsQuery.isError && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
                <FeilMelding
                  melding={lagBrukervennligFeilmelding(
                    assignmentsQuery.error instanceof Error ? assignmentsQuery.error : null,
                    { canvas: true },
                    "Kunne ikke hente oppgaver fra Canvas.",
                  )}
                />
              </div>
            )}

            {harCanvasToken && !assignmentsQuery.isLoading && !assignmentsQuery.isError && aktiveOppgaver.length === 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8">
                <div className="flex flex-col items-center justify-center text-center space-y-3">
                  <BookOpen className="w-12 h-12 text-slate-400 dark:text-slate-500" />
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">
                      Ingen aktive oppgaver funnet
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                      Vi fant ingen ikke-innleverte Canvas-oppgaver å bryte ned akkurat nå.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {harCanvasToken && !assignmentsQuery.isLoading && !assignmentsQuery.isError && aktiveOppgaver.length > 0 && (
              <div className="space-y-6">
                {aktiveOppgaver.map((assignment) => {
                  const assignmentId = assignment.id.toString();
                  const isExpanded = expandedAssignmentIds.has(assignmentId);
                  const assignmentKontekst = [
                    `Emne: ${assignment.course_name}.`,
                    assignment.due_at ? `Frist: ${formaterDatoLong(assignment.due_at)}.` : null,
                    assignment.points_possible != null ? `Poengverdi: ${assignment.points_possible}.` : null,
                  ]
                    .filter((value): value is string => value != null)
                    .join(" ");

                  return (
                    <div
                      key={assignmentId}
                      className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-all"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedAssignmentIds((current) => {
                            const neste = new Set(current);
                            if (neste.has(assignmentId)) {
                              neste.delete(assignmentId);
                            } else {
                              neste.add(assignmentId);
                            }
                            return neste;
                          })
                        }
                        className="w-full p-4 sm:p-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center shrink-0">
                            <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                              {assignment.name}
                            </h2>
                            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400">
                              <span>{assignment.course_name}</span>
                              {assignment.due_at && (
                                <>
                                  <span>•</span>
                                  <span>Frist {formaterDatoLong(assignment.due_at)}</span>
                                </>
                              )}
                              {assignment.points_possible != null && (
                                <>
                                  <span>•</span>
                                  <span>{assignment.points_possible} poeng</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 ml-4">
                          {isExpanded ? (
                            <ChevronUp className="w-5 h-5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                              Oppgavekontekst
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                              {assignmentKontekst}
                            </p>
                          </div>

                          <AITaskBreakdown
                            assignmentId={assignmentId}
                            assignmentTitle={assignment.name}
                            assignmentDescription={assignmentKontekst}
                            dueDate={assignment.due_at ? new Date(assignment.due_at) : undefined}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>
    </SidebarAppShell>
  );
}

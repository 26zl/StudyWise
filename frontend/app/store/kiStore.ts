/*
 * KI Store — global tilstand for alle KI-bakgrunnsjobber.
 * Gjør at oppgavedeling, ukeplangenerering og chat kan kjøre i bakgrunnen
 * mens brukeren navigerer mellom visninger i dashboardet.
 */
import { create } from "zustand";
import type { TaskBreakdownGenerateRequest, TaskBreakdownResponse, WeeklyPlanAssignment, WeeklyPlanSuggestionResponse, KIOppsummeringResponse } from "common/ki";
import { generateTaskBreakdownApi, saveTaskBreakdownApi, generateWeeklyPlanApi, generateOppsummeringApi } from "@/app/ki/ki-api";
import { simpleHash } from "@/app/lib/utils";

type GenerationStatus = "idle" | "pending" | "success" | "error";

interface TaskBreakdownJob {
  status: GenerationStatus;
  assignmentId: string;
  result?: TaskBreakdownResponse;
  error?: string;
}

interface WeeklyPlanJob {
  status: GenerationStatus;
  result?: WeeklyPlanSuggestionResponse;
  error?: string;
}

interface OppsummeringJob {
  status: GenerationStatus;
  result?: KIOppsummeringResponse;
  error?: string;
}

interface KIState {
  // Chat — markerer hvilken chat som kjører (brukes av ChatSection + sidebar)
  runningChatId: string | null;
  setRunningChatId: (id: string | null) => void;

  // Oppgavedeling
  taskBreakdownJobs: Record<string, TaskBreakdownJob>;
  startTaskBreakdown: (assignmentId: string, request: TaskBreakdownGenerateRequest) => void;
  clearTaskBreakdown: (assignmentId: string) => void;

  // Ukeplan
  weeklyPlanJob: WeeklyPlanJob | null;
  startWeeklyPlan: (assignments: WeeklyPlanAssignment[]) => void;
  clearWeeklyPlan: () => void;

  // Oppsummering (per tekst-hash, ikke-persistent — fersk data hver gang)
  oppsummeringJobs: Record<string, OppsummeringJob>;
  startOppsummering: (tekst: string) => string;
  clearOppsummering: (key: string) => void;
}

export const useKIStore = create<KIState>()((set) => ({
  // --- Chat ---
  runningChatId: null,
  setRunningChatId: (id) => set({ runningChatId: id }),

  // --- Oppgavedeling ---
  taskBreakdownJobs: {},

  startTaskBreakdown: (assignmentId, request) => {
    set((state) => ({
      taskBreakdownJobs: {
        ...state.taskBreakdownJobs,
        [assignmentId]: { status: "pending", assignmentId },
      },
    }));

    void generateTaskBreakdownApi(assignmentId, request)
      .then(async (data) => {
        try {
          await saveTaskBreakdownApi(assignmentId, data.subtasks);
        } catch {
          // Ignorér lagringsfeil — bruker kan lagre manuelt senere
        }

        set((state) => ({
          taskBreakdownJobs: {
            ...state.taskBreakdownJobs,
            [assignmentId]: { status: "success", assignmentId, result: data },
          },
        }));
      })
      .catch((error) => {
        set((state) => ({
          taskBreakdownJobs: {
            ...state.taskBreakdownJobs,
            [assignmentId]: {
              status: "error",
              assignmentId,
              error: error instanceof Error ? error.message : "KI-generering feilet. Prøv igjen.",
            },
          },
        }));
      });
  },

  clearTaskBreakdown: (assignmentId) => {
    set((state) => {
      const { [assignmentId]: _, ...rest } = state.taskBreakdownJobs;
      return { taskBreakdownJobs: rest };
    });
  },

  // --- Ukeplan ---
  weeklyPlanJob: null,

  startWeeklyPlan: (assignments) => {
    set({ weeklyPlanJob: { status: "pending" } });

    const sortedAssignments = [...assignments]
      .filter((a): a is WeeklyPlanAssignment & { dueAt: NonNullable<WeeklyPlanAssignment["dueAt"]> } => !!a.dueAt)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 20);

    void generateWeeklyPlanApi({ assignments: sortedAssignments })
      .then((data) => {
        set({ weeklyPlanJob: { status: "success", result: data } });
      })
      .catch((error) => {
        set({
          weeklyPlanJob: {
            status: "error",
            error: error instanceof Error ? error.message : "KI-generering feilet. Prøv igjen.",
          },
        });
      });
  },

  clearWeeklyPlan: () => {
    set({ weeklyPlanJob: null });
  },

  // --- Oppsummering ---
  oppsummeringJobs: {},

  startOppsummering: (tekst) => {
    const key = simpleHash(tekst);

    set((state) => ({
      oppsummeringJobs: {
        ...state.oppsummeringJobs,
        [key]: { status: "pending" },
      },
    }));

    void generateOppsummeringApi(tekst, "begge")
      .then((data) => {
        set((state) => ({
          oppsummeringJobs: {
            ...state.oppsummeringJobs,
            [key]: { status: "success", result: data },
          },
        }));
      })
      .catch((error) => {
        set((state) => ({
          oppsummeringJobs: {
            ...state.oppsummeringJobs,
            [key]: {
              status: "error",
              error: error instanceof Error ? error.message : "Oppsummering feilet. Prøv igjen.",
            },
          },
        }));
      });

    return key;
  },

  clearOppsummering: (key) => {
    set((state) => {
      const { [key]: _, ...rest } = state.oppsummeringJobs;
      return { oppsummeringJobs: rest };
    });
  },
}));

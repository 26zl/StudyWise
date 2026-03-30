/*
 * KI Store — global tilstand for alle KI-bakgrunnsjobber.
 * Gjør at oppgavedeling, ukeplangenerering og chat kan kjøre i bakgrunnen
 * mens brukeren navigerer mellom visninger i dashboardet.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  TaskBreakdownGenerateRequest,
  TaskBreakdownResponse,
  WeeklyPlanAssignment,
  WeeklyPlanSuggestionResponse,
  KIOppsummeringResponse,
  QuizGenerateRequest,
  QuizGenerateResponse,
  FlashcardsGenerateRequest,
  FlashcardsGenerateResponse,
} from "common/ki";
import {
  generateTaskBreakdownApi,
  saveTaskBreakdownApi,
  generateWeeklyPlanApi,
  generateOppsummeringApi,
  generateQuizApi,
  generateFlashcardsApi,
} from "@/app/ki/ki-api";
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

interface QuizJob {
  status: GenerationStatus;
  mode: "quiz" | "flashcards";
  result?: QuizGenerateResponse | FlashcardsGenerateResponse;
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

  // Quiz/Flashcards
  quizJob: QuizJob | null;
  startQuizGeneration: (request: QuizGenerateRequest) => void;
  startFlashcardGeneration: (request: FlashcardsGenerateRequest) => void;
  clearQuizJob: () => void;
  resumeQuizJob: () => void;

  // Sist kjente quiz/flashcard-forespørsel (brukes for å gjenoppta ved navigasjon)
  lastQuizRequest?: {
    mode: QuizJob["mode"];
    payload: QuizGenerateRequest | FlashcardsGenerateRequest;
  };
}

// Global peker til aktiv quiz/flashcard-forespørsel slik at den ikke avbrytes ved navigasjon.
let activeQuizJob: Promise<void> | null = null;

function kjørQuizJob(
  mode: QuizJob["mode"],
  payload: QuizGenerateRequest | FlashcardsGenerateRequest,
  set: (partial: Partial<KIState> | ((state: KIState) => Partial<KIState>)) => void,
): void {
  // Hindre dobbeltkall når en forespørsel allerede er i gang.
  if (activeQuizJob) return;

  activeQuizJob = (async () => {
    try {
      if (mode === "quiz") {
        const data = await generateQuizApi(payload as QuizGenerateRequest);
        set(() => ({
          quizJob: { status: "success", mode: "quiz", result: data },
          lastQuizRequest: undefined,
        }));
      } else {
        const data = await generateFlashcardsApi(payload as FlashcardsGenerateRequest);
        set(() => ({
          quizJob: { status: "success", mode: "flashcards", result: data },
          lastQuizRequest: undefined,
        }));
      }
    } catch (error) {
      set(() => ({
        quizJob: {
          status: "error",
          mode,
          error: error instanceof Error ? error.message : "KI-generering feilet. Prøv igjen.",
        },
      }));
    } finally {
      activeQuizJob = null;
    }
  })();
}

export const useKIStore = create<KIState>()(
  persist(
    (set, get) => ({
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

  // --- Quiz/Flashcards ---
  quizJob: null,

  startQuizGeneration: (request) => {
    const { quizJob } = get();
    if (quizJob?.status === "pending") return;

    // Lagre forespørsel slik at den kan fullføres i bakgrunnen selv om brukeren navigerer.
    set({
      quizJob: { status: "pending", mode: "quiz" },
      lastQuizRequest: { mode: "quiz", payload: request },
    });

    kjørQuizJob("quiz", request, set);
  },

  startFlashcardGeneration: (request) => {
    const { quizJob } = get();
    if (quizJob?.status === "pending") return;

    set({
      quizJob: { status: "pending", mode: "flashcards" },
      lastQuizRequest: { mode: "flashcards", payload: request },
    });

    kjørQuizJob("flashcards", request, set);
  },

  clearQuizJob: () => {
    set({ quizJob: null, lastQuizRequest: undefined });
  },

  resumeQuizJob: () => {
    const { quizJob, lastQuizRequest } = get();
    if (activeQuizJob) return;
    if (!lastQuizRequest) return;
    if (quizJob?.status === "pending") {
      kjørQuizJob(lastQuizRequest.mode, lastQuizRequest.payload, set);
    }
  },
}),
    {
      name: "ki-store-quiz-cache",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        quizJob: state.quizJob,
        lastQuizRequest: state.lastQuizRequest,
      }),
    },
  ),
);

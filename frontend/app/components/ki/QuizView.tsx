"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Sparkles,
  ChevronDown,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  Trophy,
  RotateCcw,
  Minus,
  Plus,
  AlertCircle,
  Layers,
  RotateCw,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
  Save,
  Trash2,
  BarChart3,
  BookMarked,
  Clock,
} from "lucide-react";
import { fetchApi } from "@/app/lib/apiClient";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";
import { useCanvasCourses, useCanvasModules, useCanvasFiles } from "@/app/canvas/canvas-api";
import { useHiddenCourseIds } from "@/app/auth/auth-api";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { RotatingStatusMessage } from "@/app/components/ui/RotatingStatusMessage";
import { showToast } from "@/app/components/ui/Toaster";
import { useKIStore } from "@/app/store/kiStore";
import {
  useLagreQuiz,
  useLagredeQuizer,
  useRegistrerQuizForsok,
  useSlettLagretQuiz,
} from "@/app/ki/quiz-lagret-api";
import {
  useLagreFlashcardSett,
  useLagredeFlashcardSett,
  useRegistrerFlashcardOkt,
  useSlettLagretFlashcardSett,
} from "@/app/ki/flashcards-lagret-api";
import { LagretQuizStatistikk } from "./LagretQuizStatistikk";
import { LagretFlashcardStatistikk } from "./LagretFlashcardStatistikk";
import {
  FlashcardsGenerateRequestSchema,
  FlashcardsGenerateResponseSchema,
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  type Flashcard,
  type QuizQuestion,
} from "common/ki";
import {
  LAGRET_QUIZ_SCORE_TERSKLER,
  type LagretQuiz,
  type RegistrerQuizForsokRequest,
} from "common/quizLagret";
import {
  LAGRET_FLASHCARD_SCORE_TERSKLER,
  type LagretFlashcardSett,
  type RegistrerFlashcardOktRequest,
} from "common/flashcardsLagret";

// --- Typer ---

interface CourseOption {
  id: string;
  numericId: number;
  name: string;
  emoji: string;
}

interface ModuleOption {
  id: string;
  name: string;
}

interface PersistApiLike {
  hasHydrated?: () => boolean;
  onFinishHydration?: (callback: () => void) => (() => void) | void;
}

type StudyMode = "quiz" | "flashcards";
type SetupTab = "ny" | "lagrede";
type LagredeFilter = "alle" | "quiz" | "flashcards";

interface QuizAnswerResult {
  questionId: string;
  selectedOption: string;
  correct: boolean;
}

interface QuizCompletionResult {
  score: number;
  total: number;
  durationSeconds: number;
  answers: QuizAnswerResult[];
}

interface FlashcardCompletionResult {
  known: number;
  unknown: number;
  durationSeconds: number;
}

// --- Feltkomponenter ---

function Dropdown({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string | null;
  options: { id: string; name: string; emoji?: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-5 py-4 pr-12 text-base text-slate-900 shadow-sm transition-colors hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:hover:border-slate-500"
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.emoji ? `${opt.emoji} ${opt.name}` : opt.name}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      />
    </div>
  );
}

function MultiSelectDropdown({
  label,
  selected,
  options,
  onToggle,
  disabled,
  countLabel,
}: {
  label: string;
  selected: string[];
  options: { id: string; name: string }[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  countLabel?: string;
}) {
  const { t } = useLanguage();
  const selectedNames = options.filter((o) => selected.includes(o.id)).map((o) => o.name);

  return (
    <fieldset
      aria-label={label}
      disabled={disabled}
      className="space-y-4 rounded-xl border border-slate-300 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-950 disabled:opacity-60"
    >
      <legend className="sr-only">{label}</legend>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {selectedNames.length > 0
          ? selectedNames.length <= 2
            ? selectedNames.join(", ")
            : (countLabel ?? t("quiz.modulesSelected", { count: selectedNames.length }))
          : label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          const checkboxId = `quiz-module-${opt.id}`;
          return (
            <label
              key={opt.id}
              htmlFor={checkboxId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                isSelected
                  ? "border-blue-500 bg-blue-50 text-slate-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-white"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800",
              )}
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(opt.id)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900"
              />
              <span className="flex-1 text-sm font-medium">{opt.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function QuestionCountSelector({
  count,
  onChange,
  label,
}: {
  count: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  const { t } = useLanguage();
  const presets = [5, 10, 15, 20];
  return (
    <div className="space-y-4">
      {label && <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl border text-base font-semibold transition-all duration-200",
              count === n
                ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500"
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white",
            )}
            aria-pressed={count === n}
          >
            {n}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-3">
          <button
            type="button"
            onClick={() => onChange(Math.max(1, count - 1))}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label={t("quiz.decreaseCount")}
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-10 text-center text-base font-semibold text-slate-900 dark:text-white">
            {count}
          </span>
          <button
            type="button"
            onClick={() => onChange(Math.min(50, count + 1))}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label={t("quiz.increaseCount")}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Modusvelger ---

function ModeToggle({
  mode,
  setupTab,
  lagredeCount,
  onChangeMode,
  onOpenSaved,
}: {
  mode: StudyMode;
  setupTab: SetupTab;
  lagredeCount: number;
  onChangeMode: (m: StudyMode) => void;
  onOpenSaved: () => void;
}) {
  return (
    <div
      className="flex w-full items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 sm:inline-flex sm:w-auto sm:gap-1"
      role="tablist"
      aria-label="Velg visning"
    >
      <button
        type="button"
        onClick={() => onChangeMode("quiz")}
        role="tab"
        aria-selected={mode === "quiz" && setupTab === "ny"}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 text-xs font-medium transition-all duration-200 sm:flex-none sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm",
          mode === "quiz" && setupTab === "ny"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
        )}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
        Quiz
      </button>
      <button
        type="button"
        onClick={() => onChangeMode("flashcards")}
        role="tab"
        aria-selected={mode === "flashcards" && setupTab === "ny"}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 text-xs font-medium transition-all duration-200 sm:flex-none sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm",
          mode === "flashcards" && setupTab === "ny"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
        )}
      >
        <Layers className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
        Flashcards
      </button>
      <button
        type="button"
        onClick={onOpenSaved}
        role="tab"
        aria-selected={setupTab === "lagrede"}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 text-xs font-medium transition-all duration-200 sm:flex-none sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm",
          setupTab === "lagrede"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
        )}
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
        Lagrede
        <span className="ml-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100 sm:ml-1 sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-xs">
          {lagredeCount}
        </span>
      </button>
    </div>
  );
}

// --- Aktiv flashcard-visning ---

function FlashcardActive({
  cards,
  onFinish,
  onBack,
}: {
  cards: Flashcard[];
  onFinish: (result: FlashcardCompletionResult) => void;
  onBack: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [unknown, setUnknown] = useState(0);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    startedAtRef.current = Date.now();
    return () => {
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    };
  }, []);

  const { t } = useLanguage();

  // Samme safety-net som i QuizActive: hvis current har passert siste kort,
  // fullfør quiz-en i stedet for å krasje på card.front/back-access.
  useEffect(() => {
    if (cards.length > 0 && current >= cards.length) {
      onFinish({
        known,
        unknown,
        durationSeconds: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      });
    }
  }, [current, cards.length, known, unknown, onFinish]);

  const card = cards[current];
  const isLast = current === cards.length - 1;
  const progress = ((current + 1) / Math.max(cards.length, 1)) * 100;

  const handleMark = (didKnow: boolean) => {
    const newKnown = didKnow ? known + 1 : known;
    const newUnknown = didKnow ? unknown : unknown + 1;

    if (didKnow) setKnown((k) => k + 1);
    else setUnknown((u) => u + 1);

    if (isLast) {
      onFinish({
        known: newKnown,
        unknown: newUnknown,
        durationSeconds: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      });
    } else {
      setFlipped(false);
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
      nextTimerRef.current = setTimeout(() => setCurrent((c) => c + 1), 150);
    }
  };

  // Under onFinish-transisjonen (utløst av useEffect over) kan vi rendre null
  // i stedet for å krasje på card.front/back. Komponenten unmountes neste tick.
  if (!card) return null;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Tilbake-knapp */}
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("quiz.back")}
        </button>
      </div>

      {/* Progress */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            {t("quiz.cardProgress", { current: current + 1, total: cards.length })}
          </span>
          <div className="flex items-center gap-4">
            <span className="text-base text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-white">{known}</span>{" "}
              {t("quiz.knownCount")}
            </span>
            <span className="text-base text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-white">{unknown}</span>{" "}
              {t("quiz.practiceMoreCount")}
            </span>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <motion.div
            className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            onClick={() => setFlipped(!flipped)}
            aria-pressed={flipped}
            aria-label={flipped ? t("quiz.flipToQuestion") : t("quiz.flipToAnswer")}
            className="relative block w-full cursor-pointer select-none rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
            style={{ perspective: "1000px" }}
          >
            <motion.div
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              style={{ transformStyle: "preserve-3d" }}
              className="relative w-full min-h-80"
            >
              {/* Front */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/40">
                  <Layers className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-center text-xl font-semibold leading-relaxed text-slate-900 dark:text-white">
                  {card.front}
                </p>
                <p className="mt-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <RotateCw className="w-4 h-4" />
                  {t("quiz.tapToFlip")}
                </p>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-blue-200 bg-blue-50/80 p-10 shadow-sm dark:border-blue-900 dark:bg-blue-950/30"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t("quiz.answer")}
                </p>
                <p className="text-center text-lg leading-relaxed text-slate-900 dark:text-white">
                  {card.back}
                </p>
              </div>
            </motion.div>
          </button>

          {/* Mark buttons */}
          {flipped && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 flex items-center justify-center gap-4"
            >
              <button
                type="button"
                onClick={() => handleMark(false)}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-600 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
                {t("quiz.practiceMore")}
              </button>
              <button
                type="button"
                onClick={() => handleMark(true)}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <Check className="w-5 h-5" />
                {t("quiz.knowThis")}
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// --- Flashcard-resultatvisning ---

/**
 * Bygger en kort kontekst-streng (kurs + antall spørsmål) som sendes sammen
 * med feedback-requesten. Hjelper admin-dashboardet med å se hvilket
 * kursmateriale feedbacken gjelder, uten å lekke hele quiz-innholdet.
 */
function buildFeedbackContext(
  kind: "quiz" | "flashcards",
  courseName: string | undefined,
  itemCount: number,
): string {
  const parts: string[] = [kind === "quiz" ? "Quiz" : "Flashcards"];
  if (courseName) parts.push(`kurs: ${courseName}`);
  if (itemCount > 0) {
    parts.push(`${itemCount} ${kind === "quiz" ? "spørsmål" : "kort"}`);
  }
  return parts.join(" — ");
}

/**
 * Tommel-opp/ned-feedback for generert quiz eller flashcards.
 *
 * Gjenbruker samme backend-endepunkt som KI-chat (`/api/ki/feedback`) slik at
 * admin-dashboardet ser feedback fra alle KI-funksjoner på ett sted. messageId
 * prefikses med `quiz-` eller `flashcards-` slik at kilden lar seg skille ved
 * behov. Feedbacken er engangs-per-generering — komponenten state holder styr
 * på om bruker allerede har trykket.
 */
function ResultFeedback({
  kind,
  contextSummary,
}: {
  kind: "quiz" | "flashcards";
  contextSummary: string;
}) {
  const { t } = useLanguage();
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [messageId] = useState(() => {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${kind}-${uuid}`;
  });

  const submit = async (newRating: "up" | "down") => {
    const previous = rating;
    setRating(newRating);
    try {
      const r = await fetchApi("/api/ki/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          rating: newRating,
          question: contextSummary.slice(0, 2000),
          answer:
            kind === "quiz"
              ? "Quiz-generering fra kursmateriale"
              : "Flashcard-generering fra kursmateriale",
        }),
      });
      if (!r.ok) throw new Error("feedback");
      showToast.success(
        newRating === "up" ? t("chat.feedbackThanksGood") : t("chat.feedbackThanksBad"),
      );
    } catch {
      setRating(previous);
      showToast.error(t("chat.feedbackFailed"));
    }
  };

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <span>{t("quiz.feedbackPrompt")}</span>
      {(["up", "down"] as const).map((value) => {
        const active = rating === value;
        const Icon = value === "up" ? ThumbsUp : ThumbsDown;
        const activeClass = active
          ? value === "up"
            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 ring-1 ring-green-400 dark:ring-green-600"
            : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-400 dark:ring-red-600"
          : "hover:bg-slate-100 dark:hover:bg-slate-800";
        return (
          <button
            key={value}
            type="button"
            onClick={() => submit(value)}
            className={`rounded-lg p-2 transition-colors ${activeClass}`}
            title={value === "up" ? t("chat.feedbackGood") : t("chat.feedbackBad")}
            aria-label={value === "up" ? t("chat.feedbackGood") : t("chat.feedbackBad")}
            aria-pressed={active}
          >
            <Icon className={`h-4 w-4 ${active ? "fill-current" : ""}`} />
          </button>
        );
      })}
    </div>
  );
}

function FlashcardResults({
  known,
  total,
  onBack,
  feedbackContext,
  onSave,
  isSaving,
  onOpenSaved,
}: {
  known: number;
  total: number;
  onBack: () => void;
  feedbackContext: string;
  onSave?: () => void;
  isSaving?: boolean;
  onOpenSaved?: () => void;
}) {
  const { t } = useLanguage();
  const pct = Math.round((known / total) * 100);
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  const msg =
    pct >= 80
      ? t("quiz.resultGreat")
      : pct >= 50
        ? t("quiz.resultGood")
        : t("quiz.resultKeepPracticing");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-lg mx-auto text-center"
    >
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/40">
        <Layers className="h-12 w-12 text-blue-600 dark:text-blue-400" />
      </div>
      <p className="text-4xl mb-2">{emoji}</p>
      <h3 className="mb-3 text-3xl font-bold text-slate-900 dark:text-white">{msg}</h3>
      <p className="mb-8 text-lg text-slate-500 dark:text-slate-400">
        {t("quiz.flashcardResult", { known, total, pct })}
      </p>

      <div className="relative w-40 h-40 mx-auto mb-10">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <motion.circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="hsl(var(--foreground))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 42}
            initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - known / total) }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">{pct}%</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <ArrowLeft className="w-5 h-5" />
          {t("quiz.back")}
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            <Save className="h-5 w-5" />
            {isSaving ? "Lagrer..." : "Lagre flashcards"}
          </button>
        )}
        {onOpenSaved && (
          <button
            type="button"
            onClick={onOpenSaved}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            <BookMarked className="h-5 w-5" />
            Se lagrede flashcards
          </button>
        )}
      </div>
      <ResultFeedback kind="flashcards" contextSummary={feedbackContext} />
    </motion.div>
  );
}

// --- Aktiv quiz-visning ---

function QuizActive({
  questions,
  onFinish,
  onBack,
}: {
  questions: QuizQuestion[];
  onFinish: (result: QuizCompletionResult) => void;
  onBack: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const answersRef = useRef<QuizAnswerResult[]>([]);
  const startedAtRef = useRef<number>(Date.now());
  const { t } = useLanguage();

  // Nullstill scoreRef ved nye spørsmål for å hindre at gammel score videreføres
  useEffect(() => {
    scoreRef.current = 0;
    answersRef.current = [];
    startedAtRef.current = Date.now();
  }, [questions]);

  // Safety-net: hvis `current` har passert siste spørsmål, behandle det som
  // ferdig-signal (quizen skal avsluttes) i stedet for å vise feilmelding.
  // Dette fanger race conditions der handleNext kjører på siste spørsmål uten
  // at onFinish-transisjonen har unmountet komponenten ennå, eller der
  // sessionStorage-hydrering setter current til en verdi ute av rekkevidde.
  useEffect(() => {
    if (questions.length > 0 && current >= questions.length) {
      onFinish({
        score: scoreRef.current,
        total: questions.length,
        durationSeconds: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
        answers: answersRef.current,
      });
    }
  }, [current, questions.length, onFinish]);

  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("quiz.noQuestionsError")}
        </div>
        <div className="mt-6">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("quiz.backToSetup")}
          </button>
        </div>
      </div>
    );
  }

  const q = questions[current];
  // Under onFinish-transisjonen (utløst av useEffect over) unmountes vi neste
  // tick. Render null i stedet for å blinke feilmeldingen.
  if (!q) return null;
  const isLast = current === questions.length - 1;

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setShowExplanation(true);
    const selectedOption = q.options[idx] ?? "";
    const answer: QuizAnswerResult = {
      questionId: q.id,
      selectedOption,
      correct: idx === q.correctIndex,
    };
    answersRef.current = [...answersRef.current, answer];
    if (idx === q.correctIndex) setScore((s) => s + 1);
    if (idx === q.correctIndex) {
      scoreRef.current += 1;
    }
  };

  const handleNext = () => {
    if (isLast) {
      onFinish({
        score: scoreRef.current,
        total: questions.length,
        durationSeconds: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
        answers: answersRef.current,
      });
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setShowExplanation(false);
    }
  };

  const progress = ((current + 1) / questions.length) * 100;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Tilbake-knapp */}
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("quiz.backToSetup")}
        </button>
      </div>

      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            {t("quiz.questionProgress", { current: current + 1, total: questions.length })}
          </span>
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            {t("quiz.correctCount", { score })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <motion.div
            className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
        >
          <h3 className="mb-8 text-xl font-semibold leading-relaxed text-slate-900 dark:text-white">
            {q.question}
          </h3>

          <div className="space-y-4">
            {q.options.map((opt, idx) => {
              const isCorrect = idx === q.correctIndex;
              const isSelected = idx === selected;
              let style =
                "border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:hover:border-slate-500 dark:hover:bg-slate-900";
              if (selected !== null) {
                if (isCorrect) {
                  style =
                    "border-green-500 bg-green-50 text-slate-900 dark:border-green-500 dark:bg-green-950/40 dark:text-white";
                } else if (isSelected && !isCorrect) {
                  style =
                    "border-red-500 bg-red-50 text-slate-900 dark:border-red-500 dark:bg-red-950/40 dark:text-white";
                } else {
                  style =
                    "border-slate-300 bg-white text-slate-500 opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-400";
                }
              }
              return (
                <button
                  key={`${current}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(idx)}
                  disabled={selected !== null}
                  className={cn(
                    "flex items-center gap-4 w-full px-5 py-4 rounded-xl border text-left transition-all duration-200",
                    style,
                  )}
                >
                  <span
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 border",
                      selected !== null && isCorrect
                        ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                        : selected !== null && isSelected && !isCorrect
                          ? "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500"
                          : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400",
                    )}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-base">{opt}</span>
                  {selected !== null && isCorrect && (
                    <Check className="ml-auto h-5 w-5 text-green-600 dark:text-green-400" />
                  )}
                  {selected !== null && isSelected && !isCorrect && (
                    <X className="ml-auto h-5 w-5 text-red-600 dark:text-red-400" />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {showExplanation && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 overflow-hidden"
              >
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 dark:border-blue-900 dark:bg-blue-950/30">
                  <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t("quiz.explanation")}
                  </p>
                  <p className="text-base leading-relaxed text-slate-900 dark:text-white">
                    {q.explanation}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {selected !== null && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 flex justify-end"
            >
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {isLast ? t("quiz.seeResult") : t("quiz.nextQuestion")}
                <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// --- Resultatvisning ---

function QuizResults({
  score,
  total,
  onRestart,
  onBack,
  feedbackContext,
  onSave,
  isSaving,
  onOpenSaved,
}: {
  score: number;
  total: number;
  onRestart: () => void;
  onBack: () => void;
  feedbackContext: string;
  onSave?: () => void;
  isSaving?: boolean;
  onOpenSaved?: () => void;
}) {
  const { t } = useLanguage();
  const pct = Math.round((score / total) * 100);
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  const msg =
    pct >= 80
      ? t("quiz.resultGreat")
      : pct >= 50
        ? t("quiz.resultGood")
        : t("quiz.resultKeepPracticingShort");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-lg mx-auto text-center"
    >
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/40">
        <Trophy className="h-12 w-12 text-blue-600 dark:text-blue-400" />
      </div>
      <p className="text-4xl mb-2">{emoji}</p>
      <h3 className="mb-3 text-3xl font-bold text-slate-900 dark:text-white">{msg}</h3>
      <p className="mb-8 text-lg text-slate-500 dark:text-slate-400">
        {t("quiz.quizResult", { score, total, pct })}
      </p>

      <div className="relative w-40 h-40 mx-auto mb-10">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <motion.circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="hsl(var(--foreground))"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 42}
            initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - score / total) }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">{pct}%</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
          {t("quiz.newQuiz")}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <RotateCcw className="h-5 w-5" />
          {t("chat.retryButton")}
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            <Save className="h-5 w-5" />
            {isSaving ? "Lagrer..." : "Lagre quiz"}
          </button>
        )}
        {onOpenSaved && (
          <button
            type="button"
            onClick={onOpenSaved}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            <BookMarked className="h-5 w-5" />
            Se lagrede quizer
          </button>
        )}
      </div>
      <ResultFeedback kind="quiz" contextSummary={feedbackContext} />
    </motion.div>
  );
}

function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function LagredeQuizerPanel({
  quizer,
  isLoading,
  onReplay,
  onDelete,
  deletingId,
}: {
  quizer: LagretQuiz[];
  isLoading: boolean;
  onReplay: (quiz: LagretQuiz) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const [openStatsId, setOpenStatsId] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingView text="Laster lagrede quizer..." fullPage={false} />;
  }

  if (quizer.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        Du har ingen lagrede quizer ennå.
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {quizer.map((quiz) => {
        const sisteForsok = quiz.attempts.at(-1);
        const sistePct = sisteForsok
          ? Math.round((sisteForsok.score / sisteForsok.total) * 100)
          : null;
        const sisteBadge =
          sistePct === null
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : sistePct >= LAGRET_QUIZ_SCORE_TERSKLER.GOD
              ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
              : sistePct >= LAGRET_QUIZ_SCORE_TERSKLER.MIDDELS
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300";
        const erApen = openStatsId === quiz.id;

        return (
          <li
            key={quiz.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {quiz.title}
                  </h3>
                  {sistePct !== null && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sisteBadge}`}
                    >
                      {sistePct}%
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Emne: {quiz.topic}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                  <span>{quiz.questions.length} spørsmål</span>
                  <span className="text-slate-400 dark:text-slate-500">•</span>
                  <Clock className="h-3.5 w-3.5" />
                  <span>{formatDateTime(quiz.createdAt)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onReplay(quiz)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  <RotateCcw className="h-4 w-4" />
                  Ta på nytt
                </button>
                <button
                  type="button"
                  onClick={() => setOpenStatsId(erApen ? null : quiz.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  <BarChart3 className="h-4 w-4" />
                  {erApen ? "Skjul statistikk" : "Statistikk"}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(quiz.id)}
                  disabled={deletingId === quiz.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-all hover:border-red-300 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:border-red-800 dark:hover:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingId === quiz.id ? "Sletter..." : "Slett"}
                </button>
              </div>
            </div>

            {erApen && (
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <LagretQuizStatistikk quiz={quiz} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LagredeFlashcardsPanel({
  sett,
  isLoading,
  onReplay,
  onDelete,
  deletingId,
}: {
  sett: LagretFlashcardSett[];
  isLoading: boolean;
  onReplay: (sett: LagretFlashcardSett) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const [openStatsId, setOpenStatsId] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingView text="Laster lagrede flashcards..." fullPage={false} />;
  }

  if (sett.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        Du har ingen lagrede flashcard-sett ennå.
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {sett.map((item) => {
        const sisteOkt = item.sessions.at(-1);
        const sistePct =
          sisteOkt && sisteOkt.totalCards > 0
            ? Math.round((sisteOkt.knewCount / sisteOkt.totalCards) * 100)
            : null;
        const sisteBadge =
          sistePct === null
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : sistePct >= LAGRET_FLASHCARD_SCORE_TERSKLER.GOD
              ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
              : sistePct >= LAGRET_FLASHCARD_SCORE_TERSKLER.MIDDELS
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300";
        const erApen = openStatsId === item.id;
        return (
          <li
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {item.title}
                  </h3>
                  {sistePct !== null && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sisteBadge}`}
                    >
                      {sistePct}%
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Emne: {item.topic}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                  <span>{item.cards.length} kort</span>
                  <span className="text-slate-400 dark:text-slate-500">•</span>
                  <Clock className="h-3.5 w-3.5" />
                  <span>{formatDateTime(item.createdAt)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onReplay(item)}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  <RotateCcw className="h-4 w-4" />
                  Ta på nytt
                </button>
                <button
                  type="button"
                  onClick={() => setOpenStatsId(erApen ? null : item.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  <BarChart3 className="h-4 w-4" />
                  {erApen ? "Skjul statistikk" : "Statistikk"}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  disabled={deletingId === item.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-all hover:border-red-300 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:border-red-800 dark:hover:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingId === item.id ? "Sletter..." : "Slett"}
                </button>
              </div>
            </div>

            {erApen && (
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <LagretFlashcardStatistikk sett={item} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Hovedkomponent ---

type QuizPhase = "setup" | "active" | "results";

interface QuizViewProps {
  harCanvasToken?: boolean;
}

const uiStateStorageKey = "quiz-view-ui-state";

export function QuizView({ harCanvasToken = false }: QuizViewProps) {
  const { t } = useLanguage();
  // QuizView mountes kun når DashboardView ser view=quiz eller view=flashcards,
  // så `.withDefault("quiz")` er trygt og gir oss en ikke-nullable StudyMode.
  // clearOnDefault: false sikrer at ?view=quiz beholdes i URL-en — ellers
  // fjerner nuqs param når man bytter fra flashcards til quiz, og DashboardView
  // faller tilbake til sin egen default ("chat") og kaster brukeren til chat.
  const [studyMode, setDashboardView] = useQueryState(
    "view",
    parseAsStringLiteral(["quiz", "flashcards"] as const)
      .withDefault("quiz")
      .withOptions({ clearOnDefault: false }),
  );
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [setupTab, setSetupTab] = useState<SetupTab>("ny");
  const [lagredeFilter, setLagredeFilter] = useState<LagredeFilter>("alle");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [contentTab, setContentTab] = useState<"modules" | "files">("modules");
  const [questionCount, setQuestionCount] = useState(10);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0 });
  const [quizResultMeta, setQuizResultMeta] = useState<{
    durationSeconds: number;
    answers: QuizAnswerResult[];
  }>({
    durationSeconds: 0,
    answers: [],
  });
  const [flashcardScore, setFlashcardScore] = useState({ known: 0, total: 0 });
  const [activeSavedQuizId, setActiveSavedQuizId] = useState<string | null>(null);
  const [activeSavedFlashcardSettId, setActiveSavedFlashcardSettId] = useState<string | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);
  const [deletingFlashcardId, setDeletingFlashcardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bakgrunnsjobb fra store — for navigering mens generering pågår
  const quizJob = useKIStore((s) => s.quizJob);
  const startQuizGeneration = useKIStore((s) => s.startQuizGeneration);
  const startFlashcardGeneration = useKIStore((s) => s.startFlashcardGeneration);
  const cancelQuizJob = useKIStore((s) => s.cancelQuizJob);
  const clearQuizJob = useKIStore((s) => s.clearQuizJob);
  const resumeQuizJob = useKIStore((s) => s.resumeQuizJob);
  const replayQuiz = useKIStore((s) => s.replayQuiz);
  const replayFlashcardSett = useKIStore((s) => s.replayFlashcardSett);
  const startReplayQuiz = useKIStore((s) => s.startReplayQuiz);
  const startReplayFlashcardSett = useKIStore((s) => s.startReplayFlashcardSett);
  const clearReplay = useKIStore((s) => s.clearReplay);

  const lagredeQuizerQuery = useLagredeQuizer();
  const lagredeFlashcardsQuery = useLagredeFlashcardSett();
  const lagreQuizMutation = useLagreQuiz();
  const lagreFlashcardSettMutation = useLagreFlashcardSett();
  const slettLagretQuizMutation = useSlettLagretQuiz();
  const slettLagretFlashcardSettMutation = useSlettLagretFlashcardSett();
  const registrerQuizForsokMutation = useRegistrerQuizForsok();
  const registrerFlashcardOktMutation = useRegistrerFlashcardOkt();

  const lagredeQuizCount = lagredeQuizerQuery.data?.length ?? 0;
  const lagredeFlashcardCount = lagredeFlashcardsQuery.data?.length ?? 0;
  const lagredeTotalCount = lagredeQuizCount + lagredeFlashcardCount;

  // Forhindrer doble kall
  const hasHandledResult = useRef(false);

  const isGenerating = quizJob?.status === "pending";

  // Last inn lagret UI-tilstand slik at siden ikke føles nullstilt etter navigasjon.
  const hasHydratedUiState = useRef(false);
  useEffect(() => {
    if (hasHydratedUiState.current) return;
    hasHydratedUiState.current = true;
    try {
      const raw = sessionStorage.getItem(uiStateStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        phase?: QuizPhase;
        selectedCourseId?: string | null;
        selectedModules?: string[];
        selectedFiles?: string[];
        questionCount?: number;
        quizQuestions?: QuizQuestion[];
        flashcards?: Flashcard[];
      };
      if (parsed.selectedCourseId !== undefined) setSelectedCourseId(parsed.selectedCourseId);
      if (parsed.selectedModules) setSelectedModules(parsed.selectedModules);
      if (parsed.selectedFiles) setSelectedFiles(parsed.selectedFiles);
      if (typeof parsed.questionCount === "number") {
        const nesteAntall = Math.max(1, Math.min(50, Math.trunc(parsed.questionCount)));
        setQuestionCount(nesteAntall);
      }
      // Gjenopprett spørsmål/kort-data før phase settes
      if (parsed.quizQuestions?.length) setQuizQuestions(parsed.quizQuestions);
      if (parsed.flashcards?.length) setFlashcards(parsed.flashcards);
      // Fall tilbake til setup dersom active/results men data mangler
      if (parsed.phase === "active" || parsed.phase === "results") {
        const harData =
          (parsed.quizQuestions?.length ?? 0) > 0 || (parsed.flashcards?.length ?? 0) > 0;
        setPhase(harData ? parsed.phase : "setup");
      } else if (parsed.phase) {
        setPhase(parsed.phase);
      }
    } catch {
      // Ignorer korrupt storage
    }
  }, []);

  // Persister UI-tilstand for å beholde valg/phase på tvers av navigasjon.
  useEffect(() => {
    const payload = {
      phase,
      selectedCourseId,
      selectedModules,
      selectedFiles,
      questionCount,
      quizQuestions,
      flashcards,
    };
    try {
      sessionStorage.setItem(uiStateStorageKey, JSON.stringify(payload));
    } catch {
      // Ignorer lagringsfeil
    }
  }, [
    phase,
    selectedCourseId,
    selectedModules,
    selectedFiles,
    questionCount,
    quizQuestions,
    flashcards,
  ]);

  // Sørger for at pågående jobber gjenopptas etter navigasjon.
  useEffect(() => {
    resumeQuizJob();
  }, [resumeQuizJob]);

  // Sikrer at vi også gjenopptar etter at Zustand-persist er ferdig hydrert.
  useEffect(() => {
    const persistApi = (useKIStore as typeof useKIStore & { persist?: PersistApiLike }).persist;
    if (!persistApi) return;

    if (persistApi.hasHydrated?.()) {
      resumeQuizJob();
    }
    const unsub = persistApi.onFinishHydration?.(() => {
      resumeQuizJob();
    });
    return () => {
      unsub?.();
    };
  }, [resumeQuizJob]);

  useEffect(() => {
    if (!replayQuiz) return;
    setDashboardView("quiz");
    setSetupTab("ny");
    setQuizQuestions(replayQuiz.questions);
    setFlashcards([]);
    setFinalScore({ score: 0, total: 0 });
    setQuizResultMeta({ durationSeconds: 0, answers: [] });
    setActiveSavedQuizId(replayQuiz.id);
    setActiveSavedFlashcardSettId(null);
    setPhase("active");
    clearReplay();
  }, [replayQuiz, clearReplay, setDashboardView]);

  useEffect(() => {
    if (!replayFlashcardSett) return;
    setDashboardView("flashcards");
    setSetupTab("ny");
    setFlashcards(replayFlashcardSett.cards);
    setQuizQuestions([]);
    setFlashcardScore({ known: 0, total: 0 });
    setActiveSavedFlashcardSettId(replayFlashcardSett.id);
    setActiveSavedQuizId(null);
    setPhase("active");
    clearReplay();
  }, [replayFlashcardSett, clearReplay, setDashboardView]);

  // Hent ekte Canvas-data
  const { data: coursesData, isLoading: coursesLoading } = useCanvasCourses(harCanvasToken);
  const hiddenSet = useHiddenCourseIds();
  const selectedNumericId = selectedCourseId ? Number(selectedCourseId) : null;
  const { data: modulesData, isLoading: modulesLoading } = useCanvasModules(
    selectedNumericId,
    harCanvasToken,
  );
  const { data: filesData, isLoading: filesLoading } = useCanvasFiles(
    selectedNumericId,
    harCanvasToken,
  );

  // Transformer Canvas-kurs til dropdown-options (ekskluder skjulte emner)
  const allCourses = coursesData?.courses ?? [];
  const courseOptions: CourseOption[] = allCourses
    .filter((c) => !hiddenSet.has(c.id))
    .map((c) => ({
      id: String(c.id),
      numericId: c.id,
      name: c.name,
      emoji: "📚",
    }));
  const allCoursesHidden = allCourses.length > 0 && courseOptions.length === 0;

  const selectedCourse = courseOptions.find((c) => c.id === selectedCourseId);

  // Transformer Canvas-moduler til dropdown-options
  const moduleOptions: ModuleOption[] = useMemo(
    () =>
      (modulesData?.modules ?? []).map((m) => ({
        id: String(m.id),
        name: m.name,
      })),
    [modulesData],
  );

  // Transformer Canvas-filer til dropdown-options (kun støttede filtyper)
  const fileOptions: ModuleOption[] = useMemo(
    () =>
      (filesData ?? [])
        .filter((f) => /\.(pdf|docx?|pptx?|txt|html?)$/i.test(f.display_name))
        .map((f) => ({
          id: String(f.id),
          name: f.display_name,
        })),
    [filesData],
  );

  useEffect(() => {
    if (!selectedCourseId || coursesLoading) return;
    if (selectedCourse) return;

    // Rydd bort lagret emnevalg som ikke lenger finnes for denne brukeren.
    setSelectedCourseId(null);
    setSelectedModules([]);
    setSelectedFiles([]);
    setError(null);
  }, [coursesLoading, selectedCourse, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId || modulesLoading) return;

    const gyldigeModuler = new Set(moduleOptions.map((m) => m.id));
    setSelectedModules((prev) => {
      const neste = prev.filter((id) => gyldigeModuler.has(id));
      return neste.length === prev.length ? prev : neste;
    });
  }, [moduleOptions, modulesLoading, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId || filesLoading) return;

    const gyldigeFiler = new Set(fileOptions.map((f) => f.id));
    setSelectedFiles((prev) => {
      const neste = prev.filter((id) => gyldigeFiler.has(id));
      return neste.length === prev.length ? prev : neste;
    });
  }, [fileOptions, filesLoading, selectedCourseId]);

  // Bytt automatisk til filer-fanen hvis emnet ikke har moduler men har filer
  useEffect(() => {
    if (!selectedCourseId || modulesLoading || filesLoading) return;
    if (moduleOptions.length === 0 && fileOptions.length > 0) {
      setContentTab("files");
    } else if (moduleOptions.length > 0) {
      setContentTab("modules");
    }
  }, [selectedCourseId, moduleOptions.length, fileOptions.length, modulesLoading, filesLoading]);

  const toggleModule = useCallback((id: string) => {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }, []);

  const toggleFile = useCallback((id: string) => {
    setSelectedFiles((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  }, []);

  const selectedModuleNames = moduleOptions
    .filter((m) => selectedModules.includes(m.id))
    .map((m) => m.name);
  const selectedFileNames = fileOptions
    .filter((f) => selectedFiles.includes(f.id))
    .map((f) => f.name);
  const canGenerate = Boolean(
    selectedCourse && (selectedModuleNames.length > 0 || selectedFileNames.length > 0),
  );

  // Start generering via store
  const handleGenerate = () => {
    if (isGenerating) return;

    if (!selectedCourse) {
      const melding = t("quiz.selectionOutOfDate");
      setError(melding);
      showToast.error(melding);
      return;
    }

    if (selectedModuleNames.length === 0 && selectedFileNames.length === 0) {
      const melding = t("quiz.selectionOutOfDate");
      setError(melding);
      showToast.error(melding);
      return;
    }

    setError(null);
    setSetupTab("ny");
    setActiveSavedQuizId(null);
    setActiveSavedFlashcardSettId(null);
    hasHandledResult.current = false;
    const safeQuestionCount = Math.max(1, Math.min(50, Math.trunc(questionCount)));
    if (safeQuestionCount !== questionCount) {
      setQuestionCount(safeQuestionCount);
    }

    if (studyMode === "quiz") {
      const parsed = QuizGenerateRequestSchema.safeParse({
        courseId: selectedCourse.numericId,
        courseName: selectedCourse.name,
        ...(selectedModuleNames.length > 0 ? { moduleNames: selectedModuleNames } : {}),
        ...(selectedFileNames.length > 0 ? { fileNames: selectedFileNames } : {}),
        questionCount: safeQuestionCount,
      });
      if (!parsed.success) {
        setError(t("quiz.couldNotGenerateQuiz"));
        showToast.error(t("quiz.couldNotGenerateQuiz"));
        return;
      }
      startQuizGeneration(parsed.data);
    } else {
      const parsed = FlashcardsGenerateRequestSchema.safeParse({
        courseId: selectedCourse.numericId,
        courseName: selectedCourse.name,
        ...(selectedModuleNames.length > 0 ? { moduleNames: selectedModuleNames } : {}),
        ...(selectedFileNames.length > 0 ? { fileNames: selectedFileNames } : {}),
        cardCount: safeQuestionCount,
      });
      if (!parsed.success) {
        setError(t("quiz.couldNotGenerateFlashcards"));
        showToast.error(t("quiz.couldNotGenerateFlashcards"));
        return;
      }
      startFlashcardGeneration(parsed.data);
    }
    // Marker at vi er midt i generering slik at UI vises konsekvent etter navigasjon.
    setPhase("setup");
  };

  // Håndter bakgrunnsjobb-resultat
  useEffect(() => {
    if (!quizJob || hasHandledResult.current) return;

    if (quizJob.status === "success" && quizJob.result) {
      hasHandledResult.current = true;
      if (quizJob.mode === "quiz") {
        const parsed = QuizGenerateResponseSchema.parse(quizJob.result);
        if (parsed.questions.length === 0) {
          setError(t("quiz.noQuestionsGenerated"));
          showToast.error(t("quiz.noQuestionsGenerated"));
        } else {
          setQuizQuestions(parsed.questions);
          setPhase("active");
        }
      } else {
        const parsed = FlashcardsGenerateResponseSchema.parse(quizJob.result);
        if (parsed.flashcards.length === 0) {
          setError(t("quiz.noFlashcardsGenerated"));
          showToast.error(t("quiz.noFlashcardsGenerated"));
        } else {
          setFlashcards(parsed.flashcards);
          setPhase("active");
        }
      }
      clearQuizJob();
    }

    if (quizJob.status === "error") {
      hasHandledResult.current = true;
      const msg = quizJob.error ?? t("quiz.couldNotGenerate", { contentType: quizJob.mode });
      setError(msg);
      showToast.error(msg);
      clearQuizJob();
    }
  }, [quizJob, clearQuizJob, t]);

  const handleFinishQuiz = (result: QuizCompletionResult) => {
    setFinalScore({ score: result.score, total: result.total });
    setQuizResultMeta({ durationSeconds: result.durationSeconds, answers: result.answers });
    if (activeSavedQuizId) {
      const request: RegistrerQuizForsokRequest = {
        score: result.score,
        total: result.total,
        durationSeconds: result.durationSeconds,
        answers: result.answers,
      };
      registrerQuizForsokMutation.mutate(
        { id: activeSavedQuizId, data: request },
        {
          onSuccess: () => showToast.success("Forsøk lagret i statistikk."),
          onError: () => showToast.error("Kunne ikke lagre forsøksstatistikk."),
        },
      );
    }
    setPhase("results");
  };

  const handleFinishFlashcards = (result: FlashcardCompletionResult) => {
    setFlashcardScore({ known: result.known, total: result.known + result.unknown });
    if (activeSavedFlashcardSettId) {
      const request: RegistrerFlashcardOktRequest = {
        totalCards: result.known + result.unknown,
        knewCount: result.known,
        didNotKnowCount: result.unknown,
      };
      registrerFlashcardOktMutation.mutate(
        { id: activeSavedFlashcardSettId, data: request },
        {
          onSuccess: () => showToast.success("Økt lagret i statistikk."),
          onError: () => showToast.error("Kunne ikke lagre øktstatistikk."),
        },
      );
    }
    setPhase("results");
  };

  const handleRestart = () => {
    setPhase("active");
  };

  const handleBackToSetup = () => {
    setPhase("setup");
    setSetupTab("ny");
    setLagredeFilter("alle");
    setSelectedCourseId(null);
    setSelectedModules([]);
    setSelectedFiles([]);
    setQuestionCount(10);
    setActiveSavedQuizId(null);
    setActiveSavedFlashcardSettId(null);
    setError(null);
  };

  const handleChangeMode = (m: StudyMode) => {
    setDashboardView(m);
    setPhase("setup");
    setSetupTab("ny");
    setLagredeFilter("alle");
    setSelectedCourseId(null);
    setSelectedModules([]);
    setSelectedFiles([]);
    setQuestionCount(10);
    setActiveSavedQuizId(null);
    setActiveSavedFlashcardSettId(null);
    setError(null);
  };

  const handleLagreQuiz = () => {
    if (quizQuestions.length === 0) return;
    const topic = selectedCourse?.name ?? "Lagret quiz";
    const title = `Quiz ${topic} (${quizQuestions.length} spørsmål)`;

    lagreQuizMutation.mutate(
      {
        title,
        topic,
        questions: quizQuestions,
      },
      {
        onSuccess: (saved) => {
          setActiveSavedQuizId(saved.id);
          showToast.success("Quiz lagret.");

          if (finalScore.total > 0 && quizResultMeta.answers.length > 0) {
            registrerQuizForsokMutation.mutate(
              {
                id: saved.id,
                data: {
                  score: finalScore.score,
                  total: finalScore.total,
                  durationSeconds: quizResultMeta.durationSeconds,
                  answers: quizResultMeta.answers,
                },
              },
              {
                onSuccess: () => showToast.success("Forsøk lagret i statistikk."),
                onError: () => showToast.error("Kunne ikke lagre forsøksstatistikk."),
              },
            );
          }
        },
        onError: (err) => {
          showToast.error(err instanceof Error ? err.message : "Kunne ikke lagre quiz.");
        },
      },
    );
  };

  const handleLagreFlashcards = () => {
    if (flashcards.length === 0) return;
    const topic = selectedCourse?.name ?? "Lagret flashcard-sett";
    const title = `Flashcards ${topic} (${flashcards.length} kort)`;

    lagreFlashcardSettMutation.mutate(
      {
        title,
        topic,
        cards: flashcards,
      },
      {
        onSuccess: (saved) => {
          setActiveSavedFlashcardSettId(saved.id);
          showToast.success("Flashcards lagret.");

          if (flashcardScore.total > 0) {
            registrerFlashcardOktMutation.mutate(
              {
                id: saved.id,
                data: {
                  totalCards: flashcardScore.total,
                  knewCount: flashcardScore.known,
                  didNotKnowCount: flashcardScore.total - flashcardScore.known,
                },
              },
              {
                onSuccess: () => showToast.success("Økt lagret i statistikk."),
                onError: () => showToast.error("Kunne ikke lagre øktstatistikk."),
              },
            );
          }
        },
        onError: (err) => {
          showToast.error(err instanceof Error ? err.message : "Kunne ikke lagre flashcards.");
        },
      },
    );
  };

  const handleSlettLagretQuiz = (id: string) => {
    const bekreft = window.confirm("Er du sikker på at du vil slette denne lagrede quizen?");
    if (!bekreft) return;
    setDeletingQuizId(id);
    slettLagretQuizMutation.mutate(id, {
      onSuccess: () => {
        showToast.success("Lagret quiz slettet.");
      },
      onError: (err) => {
        showToast.error(err instanceof Error ? err.message : "Kunne ikke slette lagret quiz.");
      },
      onSettled: () => {
        setDeletingQuizId(null);
      },
    });
  };

  const handleSlettLagretFlashcardSett = (id: string) => {
    const bekreft = window.confirm(
      "Er du sikker på at du vil slette dette lagrede flashcard-settet?",
    );
    if (!bekreft) return;
    setDeletingFlashcardId(id);
    slettLagretFlashcardSettMutation.mutate(id, {
      onSuccess: () => {
        showToast.success("Lagret flashcard-sett slettet.");
      },
      onError: (err) => {
        showToast.error(
          err instanceof Error ? err.message : "Kunne ikke slette lagret flashcard-sett.",
        );
      },
      onSettled: () => {
        setDeletingFlashcardId(null);
      },
    });
  };

  const handleReplayLagretQuiz = (quiz: LagretQuiz) => {
    startReplayQuiz({
      id: quiz.id,
      title: quiz.title,
      topic: quiz.topic,
      questions: quiz.questions,
    });
    showToast.success("Starter lagret quiz.");
  };

  const handleReplayLagretFlashcardSett = (sett: LagretFlashcardSett) => {
    startReplayFlashcardSett({
      id: sett.id,
      title: sett.title,
      topic: sett.topic,
      cards: sett.cards,
    });
    showToast.success("Starter lagret flashcard-økt.");
  };

  return (
    <div className="min-h-full">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-purple-500 to-blue-500">
              {studyMode === "quiz" ? (
                <Brain className="h-6 w-6 text-white" />
              ) : (
                <Layers className="h-6 w-6 text-white" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {t("quiz.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("quiz.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8">
          <AnimatePresence mode="wait">
            {/* === SETUP === */}
            {phase === "setup" && (
              <motion.div
                key="setup"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Mode Toggle */}
                <div className="mb-10">
                  <ModeToggle
                    mode={studyMode}
                    setupTab={setupTab}
                    lagredeCount={lagredeTotalCount}
                    onChangeMode={handleChangeMode}
                    onOpenSaved={() => {
                      setSetupTab("lagrede");
                      setLagredeFilter("alle");
                    }}
                  />
                </div>

                {setupTab === "ny" ? (
                  <>
                    {!harCanvasToken && (
                      <div className="mb-8">
                        <CanvasTokenNotice />
                      </div>
                    )}

                    {/* Step 1: Course — vises kun når Canvas-token er satt */}
                    {harCanvasToken && (
                      <div className="mb-8">
                        <label className="mb-4 block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {t("quiz.selectCourseLabel")}
                        </label>
                        {coursesLoading ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                            <LoadingView text={t("quiz.loadingCourses")} fullPage={false} />
                          </div>
                        ) : courseOptions.length === 0 ? (
                          <FeilMelding
                            melding={
                              allCoursesHidden
                                ? t("quiz.allCoursesHidden")
                                : t("quiz.noCoursesFound")
                            }
                          />
                        ) : (
                          <Dropdown
                            label={t("quiz.selectCourse")}
                            value={selectedCourseId}
                            options={courseOptions.map((c) => ({
                              id: c.id,
                              name: c.name,
                              emoji: c.emoji,
                            }))}
                            onSelect={(id) => {
                              setSelectedCourseId(id);
                              setSelectedModules([]);
                              setSelectedFiles([]);
                            }}
                          />
                        )}
                      </div>
                    )}

                    <AnimatePresence>
                      {selectedCourseId && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="mb-8 relative z-30 isolate"
                        >
                          <label className="mb-4 block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("quiz.selectModulesLabel")}
                          </label>

                          {/* Faner for moduler / filer — vises så snart emne er valgt slik at
                          brukeren ser at filer lastes parallelt (Canvas /files kan være
                          tregere enn /modules). Tellerene oppdateres når hver query er klar. */}
                          {(moduleOptions.length > 0 ||
                            fileOptions.length > 0 ||
                            modulesLoading ||
                            filesLoading) && (
                            <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                              <button
                                type="button"
                                onClick={() => setContentTab("modules")}
                                className={cn(
                                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                  contentTab === "modules"
                                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
                                )}
                              >
                                {t("quiz.modulesTab")}{" "}
                                {modulesLoading
                                  ? "(…)"
                                  : moduleOptions.length > 0
                                    ? `(${moduleOptions.length})`
                                    : ""}
                              </button>
                              <button
                                type="button"
                                onClick={() => setContentTab("files")}
                                className={cn(
                                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                  contentTab === "files"
                                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
                                )}
                              >
                                {t("quiz.filesTab")}{" "}
                                {filesLoading
                                  ? "(…)"
                                  : fileOptions.length > 0
                                    ? `(${fileOptions.length})`
                                    : ""}
                              </button>
                            </div>
                          )}

                          {contentTab === "modules" ? (
                            modulesLoading ? (
                              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                                <LoadingView text={t("quiz.loadingModules")} fullPage={false} />
                              </div>
                            ) : moduleOptions.length === 0 ? (
                              <FeilMelding melding={t("quiz.noModulesFound")} />
                            ) : (
                              <MultiSelectDropdown
                                label={t("quiz.selectModules")}
                                selected={selectedModules}
                                options={moduleOptions}
                                onToggle={toggleModule}
                              />
                            )
                          ) : filesLoading ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                              <LoadingView text={t("quiz.loadingFiles")} fullPage={false} />
                            </div>
                          ) : fileOptions.length === 0 ? (
                            <FeilMelding melding={t("quiz.noFilesFound")} />
                          ) : (
                            <MultiSelectDropdown
                              label={t("quiz.selectFiles")}
                              selected={selectedFiles}
                              options={fileOptions}
                              onToggle={toggleFile}
                              countLabel={t("quiz.filesSelected", { count: selectedFiles.length })}
                            />
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {(selectedModules.length > 0 || selectedFiles.length > 0) && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="mb-10 relative z-0"
                        >
                          <label className="mb-4 block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {studyMode === "quiz"
                              ? t("quiz.questionCountLabel")
                              : t("quiz.cardCountLabel")}
                          </label>
                          <QuestionCountSelector
                            count={questionCount}
                            onChange={setQuestionCount}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Error */}
                    {error && (
                      <div
                        role="alert"
                        className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </div>
                    )}

                    {/* Generate */}
                    <AnimatePresence>
                      {canGenerate && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="relative z-0 space-y-3"
                        >
                          <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className={cn(
                              "flex w-full items-center justify-center gap-3 rounded-xl py-4 text-lg font-semibold transition-all duration-200",
                              isGenerating
                                ? "cursor-wait bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
                            )}
                          >
                            {isGenerating ? (
                              <>
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                                >
                                  <Sparkles className="w-5 h-5" />
                                </motion.div>
                                {studyMode === "quiz"
                                  ? t("quiz.generatingQuiz")
                                  : t("quiz.generatingFlashcards")}
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-5 h-5" />
                                {studyMode === "quiz"
                                  ? t("quiz.generateQuiz")
                                  : t("quiz.generateFlashcards")}
                              </>
                            )}
                          </button>
                          {isGenerating && (
                            <>
                              <RotatingStatusMessage
                                active={isGenerating}
                                className="text-center"
                              />
                              <button
                                type="button"
                                onClick={cancelQuizJob}
                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                <X className="w-4 h-4" />
                                {t("common.actions.cancel")}
                              </button>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <div className="space-y-6">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                            Lagret innhold
                          </h3>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Filtrer mellom quizer og flashcards, eller vis alt samlet.
                          </p>
                        </div>

                        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                          <button
                            type="button"
                            onClick={() => setLagredeFilter("alle")}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                              lagredeFilter === "alle"
                                ? "bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                                : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
                            )}
                          >
                            Alle ({lagredeTotalCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setLagredeFilter("quiz")}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                              lagredeFilter === "quiz"
                                ? "bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                                : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
                            )}
                          >
                            Quiz ({lagredeQuizCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setLagredeFilter("flashcards")}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                              lagredeFilter === "flashcards"
                                ? "bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                                : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
                            )}
                          >
                            Flashcards ({lagredeFlashcardCount})
                          </button>
                        </div>
                      </div>
                    </div>

                    {lagredeFilter === "alle" &&
                      !lagredeQuizerQuery.isLoading &&
                      !lagredeFlashcardsQuery.isLoading &&
                      lagredeTotalCount === 0 && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                          Du har ingen lagret quiz eller flashcard-sett ennå.
                        </div>
                      )}

                    {(lagredeFilter === "quiz" ||
                      (lagredeFilter === "alle" &&
                        (lagredeQuizerQuery.isLoading || lagredeTotalCount > 0))) && (
                      <section className="space-y-3">
                        {lagredeFilter === "alle" && (
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Quizer
                          </h4>
                        )}
                        <LagredeQuizerPanel
                          quizer={lagredeQuizerQuery.data ?? []}
                          isLoading={lagredeQuizerQuery.isLoading}
                          onReplay={handleReplayLagretQuiz}
                          onDelete={handleSlettLagretQuiz}
                          deletingId={deletingQuizId}
                        />
                      </section>
                    )}

                    {(lagredeFilter === "flashcards" ||
                      (lagredeFilter === "alle" &&
                        (lagredeFlashcardsQuery.isLoading || lagredeTotalCount > 0))) && (
                      <section className="space-y-3">
                        {lagredeFilter === "alle" && (
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Flashcards
                          </h4>
                        )}
                        <LagredeFlashcardsPanel
                          sett={lagredeFlashcardsQuery.data ?? []}
                          isLoading={lagredeFlashcardsQuery.isLoading}
                          onReplay={handleReplayLagretFlashcardSett}
                          onDelete={handleSlettLagretFlashcardSett}
                          deletingId={deletingFlashcardId}
                        />
                      </section>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* === ACTIVE === */}
            {phase === "active" && (
              <motion.div
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {studyMode === "quiz" ? (
                  <QuizActive
                    questions={quizQuestions}
                    onFinish={handleFinishQuiz}
                    onBack={handleBackToSetup}
                  />
                ) : (
                  <FlashcardActive
                    cards={flashcards}
                    onFinish={handleFinishFlashcards}
                    onBack={handleBackToSetup}
                  />
                )}
              </motion.div>
            )}

            {/* === RESULTS === */}
            {phase === "results" && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {studyMode === "quiz" ? (
                  <QuizResults
                    score={finalScore.score}
                    total={finalScore.total}
                    onRestart={handleRestart}
                    onBack={handleBackToSetup}
                    onSave={activeSavedQuizId ? undefined : handleLagreQuiz}
                    isSaving={lagreQuizMutation.isPending}
                    onOpenSaved={() => {
                      setPhase("setup");
                      setSetupTab("lagrede");
                      setLagredeFilter("alle");
                    }}
                    feedbackContext={buildFeedbackContext(
                      "quiz",
                      selectedCourse?.name,
                      quizQuestions.length,
                    )}
                  />
                ) : (
                  <FlashcardResults
                    known={flashcardScore.known}
                    total={flashcardScore.total}
                    onBack={handleBackToSetup}
                    onSave={activeSavedFlashcardSettId ? undefined : handleLagreFlashcards}
                    isSaving={lagreFlashcardSettMutation.isPending}
                    onOpenSaved={() => {
                      setPhase("setup");
                      setSetupTab("lagrede");
                      setLagredeFilter("alle");
                    }}
                    feedbackContext={buildFeedbackContext(
                      "flashcards",
                      selectedCourse?.name,
                      flashcards.length,
                    )}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";
import { useCanvasCourses, useCanvasModules } from "@/app/canvas/canvas-api";
import { useHiddenCourseIds } from "@/app/auth/auth-api";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useKIStore } from "@/app/store/kiStore";
import {
  FlashcardsGenerateRequestSchema,
  FlashcardsGenerateResponseSchema,
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  type Flashcard,
  type QuizQuestion,
} from "common/ki";

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
}: {
  label: string;
  selected: string[];
  options: { id: string; name: string }[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
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
            : `${selectedNames.length} moduler valgt`
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
      {label && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      )}
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
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
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
  onChangeMode,
}: {
  mode: StudyMode;
  onChangeMode: (m: StudyMode) => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800"
      role="tablist"
      aria-label={t("quiz.selectStudyMode")}
    >
      <button
        type="button"
        onClick={() => onChangeMode("quiz")}
        role="tab"
        aria-selected={mode === "quiz"}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
          mode === "quiz"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        )}
      >
        <Brain className="w-4 h-4" />
        Quiz
      </button>
      <button
        type="button"
        onClick={() => onChangeMode("flashcards")}
        role="tab"
        aria-selected={mode === "flashcards"}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
          mode === "flashcards"
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        )}
      >
        <Layers className="w-4 h-4" />
        Flashcards
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
  onFinish: (known: number, unknown: number) => void;
  onBack: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [unknown, setUnknown] = useState(0);

  const card = cards[current];
  const isLast = current === cards.length - 1;
  const progress = ((current + 1) / cards.length) * 100;

  const handleMark = (didKnow: boolean) => {
    const newKnown = didKnow ? known + 1 : known;
    const newUnknown = didKnow ? unknown : unknown + 1;
    
    if (didKnow) setKnown((k) => k + 1);
    else setUnknown((u) => u + 1);

    if (isLast) {
      onFinish(newKnown, newUnknown);
    } else {
      setFlipped(false);
      setTimeout(() => setCurrent((c) => c + 1), 150);
    }
  };

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
          Tilbake
        </button>
      </div>

      {/* Progress */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            Kort {current + 1} av {cards.length}
          </span>
          <div className="flex items-center gap-4">
            <span className="text-base text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-white">{known}</span> kan
            </span>
            <span className="text-base text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-white">{unknown}</span> øv mer
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
            aria-label={flipped ? "Vis spørsmålet på forsiden av kortet" : "Snu kortet for å vise svaret"}
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
                  Trykk for å snu
                </p>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-blue-200 bg-blue-50/80 p-10 shadow-sm dark:border-blue-900 dark:bg-blue-950/30"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Svar
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
                Øv mer
              </button>
              <button
                type="button"
                onClick={() => handleMark(true)}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <Check className="w-5 h-5" />
                Kan dette
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// --- Flashcard-resultatvisning ---

function FlashcardResults({
  known,
  total,
  onBack,
}: {
  known: number;
  total: number;
  onBack: () => void;
}) {
  const pct = Math.round((known / total) * 100);
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  const msg = pct >= 80 ? "Fantastisk!" : pct >= 50 ? "Bra jobbet!" : "Fortsett å øve!";

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
        Du kunne <span className="font-semibold text-slate-900 dark:text-white">{known}</span> av{" "}
        <span className="font-semibold text-slate-900 dark:text-white">{total}</span> kort ({pct}%)
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

      <button
        type="button"
        onClick={onBack}
        className="mx-auto flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        <ArrowLeft className="w-5 h-5" />
        Tilbake
      </button>
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
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);

  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Quizen mangler spørsmål. Gå tilbake og generer på nytt.
        </div>
        <div className="mt-6">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Tilbake til oppsett
          </button>
        </div>
      </div>
    );
  }

  const q = questions[current];
  if (!q) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Kunne ikke laste aktivt spørsmål. Gå tilbake og prøv igjen.
        </div>
        <div className="mt-6">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Tilbake til oppsett
          </button>
        </div>
      </div>
    );
  }
  const isLast = current === questions.length - 1;

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setShowExplanation(true);
    if (idx === q.correctIndex) setScore((s) => s + 1);
    if (idx === q.correctIndex) {
      scoreRef.current += 1;
    }
  };

  const handleNext = () => {
    if (isLast) {
      onFinish(scoreRef.current, questions.length);
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
          Tilbake til oppsett
        </button>
      </div>

      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            Spørsmål {current + 1} av {questions.length}
          </span>
          <span className="text-base font-medium text-slate-500 dark:text-slate-400">
            {score} riktige
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
                  key={idx}
                  type="button"
                  onClick={() => handleSelect(idx)}
                  disabled={selected !== null}
                  className={cn(
                    "flex items-center gap-4 w-full px-5 py-4 rounded-xl border text-left transition-all duration-200",
                    style
                  )}
                >
                  <span
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 border",
                      selected !== null && isCorrect
                        ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                        : selected !== null && isSelected && !isCorrect
                        ? "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500"
                        : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
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
                    Forklaring
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
                {isLast ? "Se resultat" : "Neste spørsmål"}
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
}: {
  score: number;
  total: number;
  onRestart: () => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const pct = Math.round((score / total) * 100);
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  const msg = pct >= 80 ? "Fantastisk!" : pct >= 50 ? "Bra jobbet!" : "Øv mer!";

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
        Du fikk <span className="font-semibold text-slate-900 dark:text-white">{score}</span> av{" "}
        <span className="font-semibold text-slate-900 dark:text-white">{total}</span> riktige ({pct}%)
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

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-base font-medium text-slate-600 transition-all hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
          {t("quiz.newQuiz")}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <RotateCcw className="w-5 h-5" />
          {t("chat.retryButton")}
        </button>
      </div>
    </motion.div>
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
  const [dashboardView, setDashboardView] = useQueryState(
    "view",
    parseAsStringLiteral(["quiz", "flashcards"] as const),
  );
  const studyMode: StudyMode = dashboardView === "flashcards" ? "flashcards" : "quiz";
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0 });
  const [flashcardScore, setFlashcardScore] = useState({ known: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Bakgrunnsjobb fra store — for navigering mens generering pågår
  const quizJob = useKIStore((s) => s.quizJob);
  const startQuizGeneration = useKIStore((s) => s.startQuizGeneration);
  const startFlashcardGeneration = useKIStore((s) => s.startFlashcardGeneration);
  const cancelQuizJob = useKIStore((s) => s.cancelQuizJob);
  const clearQuizJob = useKIStore((s) => s.clearQuizJob);
  const resumeQuizJob = useKIStore((s) => s.resumeQuizJob);

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
        questionCount?: number;
        quizQuestions?: QuizQuestion[];
        flashcards?: Flashcard[];
      };
      if (parsed.selectedCourseId !== undefined) setSelectedCourseId(parsed.selectedCourseId);
      if (parsed.selectedModules) setSelectedModules(parsed.selectedModules);
      if (typeof parsed.questionCount === "number") {
        const nesteAntall = Math.max(1, Math.min(50, Math.trunc(parsed.questionCount)));
        setQuestionCount(nesteAntall);
      }
      // Gjenopprett spørsmål/kort-data før phase settes
      if (parsed.quizQuestions?.length) setQuizQuestions(parsed.quizQuestions);
      if (parsed.flashcards?.length) setFlashcards(parsed.flashcards);
      // Fall tilbake til setup dersom active/results men data mangler
      if (parsed.phase === "active" || parsed.phase === "results") {
        const harData = (parsed.quizQuestions?.length ?? 0) > 0 || (parsed.flashcards?.length ?? 0) > 0;
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
      questionCount,
      quizQuestions,
      flashcards,
    };
    try {
      sessionStorage.setItem(uiStateStorageKey, JSON.stringify(payload));
    } catch {
      // Ignorer lagringsfeil
    }
  }, [phase, selectedCourseId, selectedModules, questionCount, quizQuestions, flashcards]);

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

  // Hent ekte Canvas-data
  const { data: coursesData, isLoading: coursesLoading } = useCanvasCourses(harCanvasToken);
  const hiddenSet = useHiddenCourseIds();
  const selectedNumericId = selectedCourseId ? Number(selectedCourseId) : null;
  const { data: modulesData, isLoading: modulesLoading } = useCanvasModules(
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
  const moduleOptions: ModuleOption[] = (modulesData?.modules ?? []).map((m) => ({
    id: String(m.id),
    name: m.name,
  }));

  useEffect(() => {
    if (!selectedCourseId || coursesLoading) return;
    if (selectedCourse) return;

    // Rydd bort lagret emnevalg som ikke lenger finnes for denne brukeren.
    setSelectedCourseId(null);
    setSelectedModules([]);
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

  const toggleModule = useCallback((id: string) => {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }, []);

  const selectedModuleNames = moduleOptions
    .filter((m) => selectedModules.includes(m.id))
    .map((m) => m.name);
  const canGenerate = Boolean(selectedCourse && selectedModuleNames.length > 0);

  // Start generering via store
  const handleGenerate = () => {
    if (isGenerating) return;

    if (!selectedCourse) {
      const melding = t("quiz.selectionOutOfDate");
      setError(melding);
      showToast.error(melding);
      return;
    }

    if (selectedModuleNames.length === 0) {
      const melding = t("quiz.selectionOutOfDate");
      setError(melding);
      showToast.error(melding);
      return;
    }

    setError(null);
    hasHandledResult.current = false;
    const safeQuestionCount = Math.max(1, Math.min(50, Math.trunc(questionCount)));
    if (safeQuestionCount !== questionCount) {
      setQuestionCount(safeQuestionCount);
    }

    if (studyMode === "quiz") {
      const parsed = QuizGenerateRequestSchema.safeParse({
        courseId: selectedCourse.numericId,
        courseName: selectedCourse.name,
        moduleNames: selectedModuleNames,
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
        moduleNames: selectedModuleNames,
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

  const handleFinishQuiz = (score: number, total: number) => {
    setFinalScore({ score, total });
    setPhase("results");
  };

  const handleFinishFlashcards = (known: number, unknown: number) => {
    setFlashcardScore({ known, total: known + unknown });
    setPhase("results");
  };

  const handleRestart = () => {
    setPhase("active");
  };

  const handleBackToSetup = () => {
    setPhase("setup");
    setSelectedCourseId(null);
    setSelectedModules([]);
    setQuestionCount(10);
    setError(null);
  };

  const handleChangeMode = (m: StudyMode) => {
    setDashboardView(m);
    setPhase("setup");
    setSelectedCourseId(null);
    setSelectedModules([]);
    setQuestionCount(10);
    setError(null);
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
                Quiz / Flashcards
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Tren på Canvas-innholdet ditt med KI-genererte spørsmål og kort.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8">
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
                  <ModeToggle mode={studyMode} onChangeMode={handleChangeMode} />
                </div>

                {!harCanvasToken && (
                  <div className="mb-8">
                    <CanvasTokenNotice />
                  </div>
                )}

                {/* Step 1: Course */}
                <div className="mb-8">
                  <label className="mb-4 block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    1. Velg emne
                  </label>
                  {!harCanvasToken ? null : coursesLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <LoadingView text={t("quiz.loadingCourses")} fullPage={false} />
                    </div>
                  ) : courseOptions.length === 0 ? (
                    <FeilMelding melding={allCoursesHidden ? t("quiz.allCoursesHidden") : t("quiz.noCoursesFound")} />
                  ) : (
                    <Dropdown
                      label={t("quiz.selectCourse")}
                      value={selectedCourseId}
                      options={courseOptions.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
                      onSelect={(id) => {
                        setSelectedCourseId(id);
                        setSelectedModules([]);
                      }}
                    />
                  )}
                </div>

                {/* Step 2: Modules */}
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
                        2. Velg moduler
                      </label>
                      {modulesLoading ? (
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
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Step 3: Question count */}
                <AnimatePresence>
                  {selectedModules.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="mb-10 relative z-0"
                    >
                      <label className="mb-4 block text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        3. {studyMode === "quiz" ? "Antall spørsmål" : "Antall kort"}
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
                            : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
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
                            {studyMode === "quiz" ? t("quiz.generatingQuiz") : t("quiz.generatingFlashcards")}
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            {studyMode === "quiz" ? t("quiz.generateQuiz") : t("quiz.generateFlashcards")}
                          </>
                        )}
                      </button>
                      {isGenerating && (
                        <button
                          type="button"
                          onClick={cancelQuizJob}
                          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <X className="w-4 h-4" />
                          {t("common.actions.cancel")}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
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
                  <QuizActive questions={quizQuestions} onFinish={handleFinishQuiz} onBack={handleBackToSetup} />
                ) : (
                  <FlashcardActive cards={flashcards} onFinish={handleFinishFlashcards} onBack={handleBackToSetup} />
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
                  />
                ) : (
                  <FlashcardResults
                    known={flashcardScore.known}
                    total={flashcardScore.total}
                    onBack={handleBackToSetup}
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

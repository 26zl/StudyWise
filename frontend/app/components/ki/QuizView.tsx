"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
import { useCanvasCourses, useCanvasModules } from "@/app/canvas/canvas-api";
import { fetchApi } from "@/app/lib/apiClient";
import { toast } from "sonner";

// --- Typer ---

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

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

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

type StudyMode = "quiz" | "flashcards";

// --- Dropdown-komponenter ---

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-between w-full px-5 py-4 rounded-xl border text-base transition-all duration-200",
          open
            ? "border-foreground/20 bg-card shadow-[var(--shadow-md)]"
            : "border-border bg-card hover:border-foreground/10"
        )}
      >
        <span className={cn(selected ? "text-foreground font-medium" : "text-muted-foreground")}>
          {selected ? (
            <span className="flex items-center gap-3">
              {selected.emoji && <span className="text-lg">{selected.emoji}</span>}
              {selected.name}
            </span>
          ) : (
            label
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 w-full bg-white dark:bg-neutral-900 border border-border rounded-xl shadow-[var(--shadow-lg)] overflow-hidden max-h-72 overflow-y-auto"
          >
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 w-full px-5 py-3.5 text-base text-left transition-colors",
                  value === opt.id
                    ? "bg-accent text-foreground font-medium"
                    : "text-foreground hover:bg-accent/50"
                )}
              >
                {opt.emoji && <span className="text-lg">{opt.emoji}</span>}
                <span className="flex-1 truncate">{opt.name}</span>
                {value === opt.id && <Check className="w-5 h-5 text-foreground shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedNames = options.filter((o) => selected.includes(o.id)).map((o) => o.name);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex items-center justify-between w-full px-5 py-4 rounded-xl border text-base transition-all duration-200",
          disabled && "opacity-50 cursor-not-allowed",
          open
            ? "border-foreground/20 bg-card shadow-[var(--shadow-md)]"
            : "border-border bg-card hover:border-foreground/10"
        )}
      >
        <span className={cn(selectedNames.length > 0 ? "text-foreground font-medium" : "text-muted-foreground")}>
          {selectedNames.length > 0
            ? selectedNames.length <= 2
              ? selectedNames.join(", ")
              : `${selectedNames.length} moduler valgt`
            : label}
        </span>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 w-full bg-white dark:bg-neutral-900 border border-border rounded-xl shadow-[var(--shadow-lg)] overflow-hidden max-h-72 overflow-y-auto"
          >
            {options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => onToggle(opt.id)}
                  className={cn(
                    "flex items-center gap-4 w-full px-5 py-3.5 text-base text-left transition-colors",
                    isSelected ? "bg-accent/60" : "hover:bg-accent/50"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0",
                      isSelected
                        ? "bg-foreground border-foreground"
                        : "border-border"
                    )}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-background" />}
                  </div>
                  <span className="text-foreground truncate">{opt.name}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  const presets = [5, 10, 15, 20];
  return (
    <div className="space-y-4">
      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
      <div className="flex items-center gap-3">
        {presets.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "w-14 h-14 rounded-xl text-base font-semibold border transition-all duration-200",
              count === n
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground border-border hover:border-foreground/20 hover:text-foreground"
            )}
          >
            {n}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-3">
          <button
            onClick={() => onChange(Math.max(1, count - 1))}
            className="w-11 h-11 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-10 text-center text-base font-semibold text-foreground">
            {count}
          </span>
          <button
            onClick={() => onChange(Math.min(50, count + 1))}
            className="w-11 h-11 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
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
  return (
    <div className="inline-flex items-center bg-muted rounded-xl p-1 gap-1">
      <button
        onClick={() => onChangeMode("quiz")}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
          mode === "quiz"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Brain className="w-4 h-4" />
        Quiz
      </button>
      <button
        onClick={() => onChangeMode("flashcards")}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
          mode === "flashcards"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
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
}: {
  cards: Flashcard[];
  onFinish: (known: number, unknown: number) => void;
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
      {/* Progress */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-muted-foreground">
            Kort {current + 1} av {cards.length}
          </span>
          <div className="flex items-center gap-4">
            <span className="text-base text-muted-foreground">
              <span className="text-foreground font-medium">{known}</span> kan
            </span>
            <span className="text-base text-muted-foreground">
              <span className="text-foreground font-medium">{unknown}</span> øv mer
            </span>
          </div>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-foreground rounded-full"
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
          <div
            onClick={() => setFlipped(!flipped)}
            className="relative cursor-pointer select-none"
            style={{ perspective: "1000px" }}
          >
            <motion.div
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              style={{ transformStyle: "preserve-3d" }}
              className="relative w-full min-h-[320px]"
            >
              {/* Front */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center p-10 rounded-2xl border border-border bg-card"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mb-6">
                  <Layers className="w-6 h-6 text-foreground/70" />
                </div>
                <p className="text-xl font-semibold text-foreground text-center leading-relaxed">
                  {card.front}
                </p>
                <p className="text-sm text-muted-foreground mt-6 flex items-center gap-2">
                  <RotateCw className="w-4 h-4" />
                  Klikk for å snu
                </p>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center p-10 rounded-2xl border border-border bg-accent/40"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                  Svar
                </p>
                <p className="text-lg text-foreground text-center leading-relaxed">
                  {card.back}
                </p>
              </div>
            </motion.div>
          </div>

          {/* Mark buttons */}
          {flipped && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 flex items-center justify-center gap-4"
            >
              <button
                onClick={() => handleMark(false)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl border border-border text-base font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
              >
                <X className="w-5 h-5" />
                Øv mer
              </button>
              <button
                onClick={() => handleMark(true)}
                className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-base font-medium hover:opacity-90 transition-opacity"
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
      <div className="w-24 h-24 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-6">
        <Layers className="w-12 h-12 text-foreground/70" />
      </div>
      <p className="text-4xl mb-2">{emoji}</p>
      <h3 className="text-3xl font-bold text-foreground mb-3">{msg}</h3>
      <p className="text-lg text-muted-foreground mb-8">
        Du kunne <span className="font-semibold text-foreground">{known}</span> av{" "}
        <span className="font-semibold text-foreground">{total}</span> kort ({pct}%)
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
          <span className="text-3xl font-bold text-foreground">{pct}%</span>
        </div>
      </div>

      <button
        onClick={onBack}
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-base font-medium hover:opacity-90 transition-opacity mx-auto"
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
}: {
  questions: QuizQuestion[];
  onFinish: (score: number, total: number) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);

  const q = questions[current];
  const isLast = current === questions.length - 1;

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setShowExplanation(true);
    if (idx === q.correctIndex) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (isLast) {
      // Beregn endelig score direkte for å unngå race condition med asynkron setState
      const finalScore = selected === q.correctIndex ? score + 1 : score;
      onFinish(finalScore, questions.length);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setShowExplanation(false);
    }
  };

  const progress = ((current + 1) / questions.length) * 100;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-medium text-muted-foreground">
            Spørsmål {current + 1} av {questions.length}
          </span>
          <span className="text-base font-medium text-muted-foreground">
            {score} riktige
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-foreground rounded-full"
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
          <h3 className="text-xl font-semibold text-foreground mb-8 leading-relaxed">
            {q.question}
          </h3>

          <div className="space-y-4">
            {q.options.map((opt, idx) => {
              const isCorrect = idx === q.correctIndex;
              const isSelected = idx === selected;
              let style = "border-border hover:border-foreground/20 hover:bg-accent/50";
              if (selected !== null) {
                if (isCorrect) style = "border-primary bg-accent";
                else if (isSelected && !isCorrect) style = "border-destructive bg-destructive/10";
                else style = "border-border opacity-50";
              }
              return (
                <button
                  key={idx}
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
                        ? "bg-foreground text-background border-foreground"
                        : selected !== null && isSelected && !isCorrect
                        ? "bg-destructive text-destructive-foreground border-destructive"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-base text-foreground">{opt}</span>
                  {selected !== null && isCorrect && (
                    <Check className="w-5 h-5 text-foreground ml-auto" />
                  )}
                  {selected !== null && isSelected && !isCorrect && (
                    <X className="w-5 h-5 text-destructive ml-auto" />
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
                <div className="bg-accent/60 rounded-xl px-5 py-4 border border-border">
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Forklaring
                  </p>
                  <p className="text-base text-foreground leading-relaxed">
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
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-base font-medium hover:opacity-90 transition-opacity"
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
  const pct = Math.round((score / total) * 100);
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  const msg = pct >= 80 ? "Fantastisk!" : pct >= 50 ? "Bra jobbet!" : "Øv mer!";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-lg mx-auto text-center"
    >
      <div className="w-24 h-24 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-6">
        <Trophy className="w-12 h-12 text-foreground/70" />
      </div>
      <p className="text-4xl mb-2">{emoji}</p>
      <h3 className="text-3xl font-bold text-foreground mb-3">{msg}</h3>
      <p className="text-lg text-muted-foreground mb-8">
        Du fikk <span className="font-semibold text-foreground">{score}</span> av{" "}
        <span className="font-semibold text-foreground">{total}</span> riktige ({pct}%)
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
          <span className="text-3xl font-bold text-foreground">{pct}%</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 rounded-xl border border-border text-base font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
          Ny quiz
        </button>
        <button
          onClick={onRestart}
          className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-base font-medium hover:opacity-90 transition-opacity"
        >
          <RotateCcw className="w-5 h-5" />
          Prøv igjen
        </button>
      </div>
    </motion.div>
  );
}

// --- Hovedkomponent ---

type QuizPhase = "setup" | "active" | "results";

export function QuizView() {
  const [studyMode, setStudyMode] = useState<StudyMode>("quiz");
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0 });
  const [flashcardScore, setFlashcardScore] = useState({ known: 0, total: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hent ekte Canvas-data
  const { data: coursesData, isLoading: coursesLoading } = useCanvasCourses();
  const selectedNumericId = selectedCourseId ? Number(selectedCourseId) : null;
  const { data: modulesData, isLoading: modulesLoading } = useCanvasModules(selectedNumericId);

  // Transformer Canvas-kurs til dropdown-options
  const courseOptions: CourseOption[] = (coursesData?.courses ?? []).map((c) => ({
    id: String(c.id),
    numericId: c.id,
    name: c.name,
    emoji: "📚",
  }));

  const selectedCourse = courseOptions.find((c) => c.id === selectedCourseId);

  // Transformer Canvas-moduler til dropdown-options
  const moduleOptions: ModuleOption[] = (modulesData?.modules ?? []).map((m) => ({
    id: String(m.id),
    name: m.name,
  }));

  const toggleModule = useCallback((id: string) => {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }, []);

  const canGenerate = selectedCourseId && selectedModules.length > 0;

  const handleGenerate = async () => {
    if (!selectedCourse || selectedModules.length === 0) return;
    setIsGenerating(true);
    setError(null);

    const moduleNames = moduleOptions
      .filter((m) => selectedModules.includes(m.id))
      .map((m) => m.name);

    // Generering kan ta opptil 2 minutter
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    const endpoint = studyMode === "quiz" ? "/api/quiz/generate" : "/api/flashcards/generate";

    try {
      const res = await fetchApi(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourse.numericId,
          courseName: selectedCourse.name,
          moduleNames,
          [studyMode === "quiz" ? "questionCount" : "cardCount"]: questionCount,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding ?? data.feil ?? `Feil ${res.status}`);
      }

      const data = await res.json();

      if (studyMode === "quiz") {
        if (!data.questions || data.questions.length === 0) {
          throw new Error("Ingen spørsmål ble generert");
        }
        setQuizQuestions(data.questions);
      } else {
        if (!data.flashcards || data.flashcards.length === 0) {
          throw new Error("Ingen flashcards ble generert");
        }
        setFlashcards(data.flashcards);
      }

      setPhase("active");
    } catch (err) {
      clearTimeout(timeoutId);
      const contentType = studyMode === "quiz" ? "quiz" : "flashcards";
      const msg = err instanceof Error 
        ? (err.name === "AbortError" ? "Forespørselen tok for lang tid" : err.message) 
        : `Kunne ikke generere ${contentType}`;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  };

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
    setStudyMode(m);
    setPhase("setup");
    setSelectedCourseId(null);
    setSelectedModules([]);
    setQuestionCount(10);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-12">
          <AnimatePresence mode="wait">
            {/* === SETUP === */}
            {phase === "setup" && (
              <motion.div
                key="setup"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Header */}
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
                    {studyMode === "quiz" ? (
                      <Brain className="w-7 h-7 text-foreground/70" />
                    ) : (
                      <Layers className="w-7 h-7 text-foreground/70" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">
                      Quiz / Flashcards
                    </h2>
                    <p className="text-base text-muted-foreground">
                      {studyMode === "quiz"
                        ? "Lag en KI-generert quiz basert på Canvas-innholdet ditt"
                        : "Lag KI-genererte flashcards for effektiv repetisjon"}
                    </p>
                  </div>
                </div>

                {/* Mode Toggle */}
                <div className="mb-10">
                  <ModeToggle mode={studyMode} onChangeMode={handleChangeMode} />
                </div>

                {/* Step 1: Course */}
                <div className="mb-8">
                  <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 block">
                    1. Velg emne
                  </label>
                  {coursesLoading ? (
                    <div className="px-5 py-4 rounded-xl border border-border bg-card text-base text-muted-foreground">
                      Laster emner...
                    </div>
                  ) : courseOptions.length === 0 ? (
                    <div className="flex items-center gap-3 px-5 py-4 rounded-xl border border-border bg-card text-base text-muted-foreground">
                      <AlertCircle className="w-5 h-5" />
                      Ingen Canvas-emner funnet. Koble til Canvas først.
                    </div>
                  ) : (
                    <Dropdown
                      label="Velg et emne..."
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
                      <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 block">
                        2. Velg moduler
                      </label>
                      {modulesLoading ? (
                        <div className="px-5 py-4 rounded-xl border border-border bg-card text-base text-muted-foreground">
                          Laster moduler...
                        </div>
                      ) : moduleOptions.length === 0 ? (
                        <div className="flex items-center gap-3 px-5 py-4 rounded-xl border border-border bg-card text-base text-muted-foreground">
                          <AlertCircle className="w-5 h-5" />
                          Ingen moduler funnet for dette emnet
                        </div>
                      ) : (
                        <MultiSelectDropdown
                          label="Velg moduler..."
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
                      <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 block">
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
                  <div className="mb-6 flex items-center gap-3 px-5 py-4 rounded-xl border border-destructive/30 bg-destructive/5 text-base text-destructive">
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
                      className="relative z-0"
                    >
                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className={cn(
                          "flex items-center justify-center gap-3 w-full py-4 rounded-xl text-lg font-semibold transition-all duration-200",
                          isGenerating
                            ? "bg-muted text-muted-foreground cursor-wait"
                            : "bg-foreground text-background hover:opacity-90"
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
                            {studyMode === "quiz" ? "Genererer quiz..." : "Genererer flashcards..."}
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            {studyMode === "quiz" ? "Generer quiz" : "Generer flashcards"}
                          </>
                        )}
                      </button>
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
                  <QuizActive questions={quizQuestions} onFinish={handleFinishQuiz} />
                ) : (
                  <FlashcardActive cards={flashcards} onFinish={handleFinishFlashcards} />
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

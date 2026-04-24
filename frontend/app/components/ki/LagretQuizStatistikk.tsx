"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Clock3, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { LAGRET_QUIZ_SCORE_TERSKLER, type LagretQuiz, type QuizForsok } from "common/quizLagret";
import { TrendChart } from "./TrendChart";

const { GOD: TERSKEL_GOD, MIDDELS: TERSKEL_MIDDELS } = LAGRET_QUIZ_SCORE_TERSKLER;

function formatDato(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatVarighet(sekunder: number): string {
  const min = Math.floor(sekunder / 60);
  const s = sekunder % 60;
  if (min === 0) return `${s}s`;
  return `${min}m ${s}s`;
}

/**
 * Detaljert statistikkvisning for én lagret quiz — trend, forsøksliste og per-spørsmål.
 */
export function LagretQuizStatistikk({ quiz }: { quiz: LagretQuiz }) {
  const forsok = [...quiz.attempts].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null);

  if (forsok.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        Ingen forsøk registrert ennå. Ta quizen for å se statistikk.
      </div>
    );
  }

  const trendVerdier = forsok.map((f) => Math.round((f.score / f.total) * 100));
  const trendLabels = forsok.map((_, i) => String(i + 1));
  const siste = trendVerdier.at(-1) ?? 0;
  const snitt = Math.round(
    trendVerdier.reduce((sum, value) => sum + value, 0) / trendVerdier.length,
  );
  const beste = Math.max(...trendVerdier);
  const trendDelta = trendVerdier.length >= 2 ? siste - (trendVerdier[0] ?? siste) : 0;
  const trendSign = trendDelta > 0 ? "+" : "";
  const trendColor =
    trendDelta > 0
      ? "text-green-600 dark:text-green-400"
      : trendDelta < 0
        ? "text-red-600 dark:text-red-400"
        : "text-slate-700 dark:text-slate-300";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatKort label="Siste" value={`${siste}%`} />
        <StatKort label="Snitt" value={`${snitt}%`} />
        <StatKort label="Beste" value={`${beste}%`} />
        <StatKort label="Trend" value={`${trendSign}${trendDelta}%`} valueClassName={trendColor} />
      </div>

      {/* Trend-diagram */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Score-utvikling
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Resultater over {forsok.length} forsøk
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              &gt;={TERSKEL_GOD}%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {TERSKEL_MIDDELS}-{TERSKEL_GOD - 1}%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              &lt;{TERSKEL_MIDDELS}%
            </span>
          </div>
        </div>

        <TrendChart
          values={trendVerdier}
          labels={trendLabels}
          ariaLabel="Score-utvikling i prosent over tid"
          height={120}
          goodThreshold={TERSKEL_GOD}
          mediumThreshold={TERSKEL_MIDDELS}
        />
      </div>

      {/* Forsøksliste — nyeste først */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Tidligere forsøk
          </h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">{forsok.length} totalt</span>
        </div>
        <ul className="space-y-2 p-2">
          {[...forsok].reverse().map((f) => (
            <ForsokKort
              key={f.attemptId}
              forsok={f}
              quiz={quiz}
              isOpen={openAttemptId === f.attemptId}
              onToggle={() => {
                setOpenAttemptId((prev) => (prev === f.attemptId ? null : f.attemptId));
              }}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatKort({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold text-slate-900 dark:text-white ${valueClassName ?? ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function ForsokKort({
  forsok,
  quiz,
  isOpen,
  onToggle,
}: {
  forsok: QuizForsok;
  quiz: LagretQuiz;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pct = Math.round((forsok.score / forsok.total) * 100);
  const badge =
    pct >= TERSKEL_GOD
      ? "bg-green-100 text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900"
      : pct >= TERSKEL_MIDDELS
        ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900"
        : "bg-red-100 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900";

  return (
    <li className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}>
            {pct}% ({forsok.score}/{forsok.total})
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="h-3.5 w-3.5" />
            {formatDato(forsok.date)}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">•</span>
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {formatVarighet(forsok.durationSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{isOpen ? "Skjul" : "Vis detaljer"}</span>
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isOpen && (
        <ul className="space-y-2 border-t border-slate-200 px-2 pb-2 pt-2 dark:border-slate-700">
          {forsok.answers.map((svar, i) => {
            const sporsmal = quiz.questions.find((q) => q.id === svar.questionId);
            if (!sporsmal) return null;
            const cardClass = svar.correct
              ? "border-green-200 bg-white dark:border-green-900 dark:bg-slate-900"
              : "border-red-200 bg-white dark:border-red-900 dark:bg-slate-900";

            return (
              <li
                key={`${svar.questionId}-${i}`}
                className={`rounded-md border p-3 text-sm ${cardClass}`}
              >
                <div className="mb-1.5 flex items-start gap-2">
                  {svar.correct ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500 dark:text-green-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  )}
                  <p className="font-medium leading-relaxed text-slate-900 dark:text-white">
                    {i + 1}. {sporsmal.question}
                  </p>
                </div>
                <div className="ml-6 space-y-1 text-xs">
                  <p className="text-slate-600 dark:text-slate-400">
                    <span className={svar.correct ? "" : "text-red-600 dark:text-red-400"}>
                      Ditt svar:
                    </span>{" "}
                    <span
                      className={
                        svar.correct
                          ? "font-medium text-slate-600 dark:text-slate-300"
                          : "font-medium text-red-700 dark:text-red-400"
                      }
                    >
                      {svar.selectedOption}
                    </span>
                  </p>
                  {!svar.correct && (
                    <p className="text-slate-600 dark:text-slate-400">
                      Riktig svar:{" "}
                      <span className="font-medium text-green-700 dark:text-green-400">
                        {sporsmal.options[sporsmal.correctIndex]}
                      </span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

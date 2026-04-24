"use client";

import { useState } from "react";
import { Calendar, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import {
  LAGRET_FLASHCARD_SCORE_TERSKLER,
  type FlashcardOkt,
  type LagretFlashcardSett,
} from "common/flashcardsLagret";
import { TrendChart } from "./TrendChart";

const { GOD: TERSKEL_GOD, MIDDELS: TERSKEL_MIDDELS } = LAGRET_FLASHCARD_SCORE_TERSKLER;

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

/**
 * Detaljert statistikkvisning for ett lagret flashcard-sett — trend, øktliste og per-økt detaljer.
 */
export function LagretFlashcardStatistikk({ sett }: { sett: LagretFlashcardSett }) {
  const okter = [...sett.sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  if (okter.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        Ingen økter registrert ennå. Øv på settet for å se statistikk.
      </div>
    );
  }

  const trendVerdier = okter.map((o) =>
    o.totalCards > 0 ? Math.round((o.knewCount / o.totalCards) * 100) : 0,
  );
  const trendLabels = okter.map((_, i) => String(i + 1));
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
              Resultater over {okter.length} økter
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
          ariaLabel="Utvikling i andel kjente kort over tid"
          height={120}
          goodThreshold={TERSKEL_GOD}
          mediumThreshold={TERSKEL_MIDDELS}
        />
      </div>

      {/* Øktliste — nyeste først */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Tidligere økter
          </h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">{okter.length} totalt</span>
        </div>
        <ul className="space-y-2 p-2">
          {[...okter].reverse().map((okt) => (
            <OktKort
              key={okt.sessionId}
              okt={okt}
              isOpen={openSessionId === okt.sessionId}
              onToggle={() => {
                setOpenSessionId((prev) => (prev === okt.sessionId ? null : okt.sessionId));
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

function OktKort({
  okt,
  isOpen,
  onToggle,
}: {
  okt: FlashcardOkt;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pct = okt.totalCards > 0 ? Math.round((okt.knewCount / okt.totalCards) * 100) : 0;
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
            {pct}% ({okt.knewCount}/{okt.totalCards})
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="h-3.5 w-3.5" />
            {formatDato(okt.date)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{isOpen ? "Skjul" : "Vis detaljer"}</span>
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="grid gap-2 border-t border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400 sm:grid-cols-3">
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            Kort øvd:{" "}
            <span className="font-medium text-slate-900 dark:text-white">{okt.totalCards}</span>
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            <Check className="mr-1 inline h-4 w-4 text-green-600 dark:text-green-400" />
            Kjente:{" "}
            <span className="font-medium text-slate-900 dark:text-white">{okt.knewCount}</span>
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            <X className="mr-1 inline h-4 w-4 text-red-600 dark:text-red-400" />
            Ikke kjente:{" "}
            <span className="font-medium text-slate-900 dark:text-white">
              {okt.didNotKnowCount}
            </span>
          </p>
        </div>
      )}
    </li>
  );
}

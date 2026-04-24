"use client";

import { motion } from "framer-motion";

/**
 * Søylediagram for score-trend over tid. Bruker divs med flex-layout slik at
 * søylebredden ikke strekkes når det er få forsøk.
 */
interface TrendChartProps {
  /** Dataserier — venstre til høyre = eldst til nyest. Verdier i 0–100 (prosent). */
  values: number[];
  /** Etiketter under hver søyle. */
  labels?: string[];
  /** Tilgjengelig etikett for diagrammet. */
  ariaLabel: string;
  /** Høyde i piksler for søyleområdet. Default 140. */
  height?: number;
  /** Terskel (%) for grønn farge. Default 80. */
  goodThreshold?: number;
  /** Terskel (%) for gul farge. Default 50. */
  mediumThreshold?: number;
}

const TICKS = [100, 75, 50, 25, 0];

export function TrendChart({
  values,
  labels,
  ariaLabel,
  height = 140,
  goodThreshold = 80,
  mediumThreshold = 50,
}: TrendChartProps) {
  if (values.length === 0) return null;

  return (
    <div className="w-full" role="img" aria-label={ariaLabel}>
      <div className="flex" style={{ height }}>
        {/* Y-akse */}
        <div
          className="flex w-7 flex-col justify-between pr-1 text-right text-[10px] text-slate-400 dark:text-slate-500"
          aria-hidden="true"
        >
          {TICKS.map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>

        {/* Plottingsområde */}
        <div className="relative flex-1">
          {/* Gridlinjer */}
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {TICKS.map((t) => (
              <div
                key={t}
                className="border-t border-dashed border-slate-200 dark:border-slate-700"
              />
            ))}
          </div>

          {/* Søyler */}
          <div className="absolute inset-0 flex items-end gap-3 px-2">
            {values.map((v, i) => {
              const pct = Math.max(0, Math.min(100, v));
              const colorClass =
                pct >= goodThreshold
                  ? "bg-green-500 dark:bg-green-400"
                  : pct >= mediumThreshold
                    ? "bg-amber-500 dark:bg-amber-400"
                    : "bg-red-500 dark:bg-red-400";
              return (
                <motion.div
                  key={i}
                  className={`max-w-[48px] flex-1 rounded-t ${colorClass}`}
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.4, delay: i * 0.04 }}
                  aria-label={`${labels?.[i] ?? i + 1}: ${pct}%`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Labels */}
      {labels && labels.length === values.length && (
        <div className="mt-1 flex pl-7">
          <div className="flex flex-1 gap-3 px-2">
            {labels.map((label, i) => (
              <span
                key={i}
                className="max-w-[48px] flex-1 text-center text-[10px] text-slate-500 dark:text-slate-400"
              >
                #{label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

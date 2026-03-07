/*
 * FeilMelding - Felles komponent for feil, advarsler og info-meldinger
 * Sørger for konsistent utseende og tilgjengelighet på tvers av appen
 */
"use client";

import { AlertCircle, AlertTriangle, Info } from "lucide-react";

export type FeilMeldingType = "error" | "warning" | "info";

interface FeilMeldingProps {
  /** Meldingstekst som vises til brukeren */
  melding: string;
  /** Type: error (rød), warning (gul/oransje), info (nøytral) */
  type?: FeilMeldingType;
}

const typeStyles: Record<FeilMeldingType, string> = {
  error:
    "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
  warning:
    "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200",
  info: "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200",
};

const iconColor: Record<FeilMeldingType, string> = {
  error: "text-red-500 dark:text-red-400 shrink-0",
  warning: "text-amber-500 dark:text-amber-400 shrink-0",
  info: "text-slate-500 dark:text-slate-400 shrink-0",
};

export function FeilMelding({ melding, type = "error" }: FeilMeldingProps) {
  const styles = typeStyles[type];
  const Icon =
    type === "error"
      ? AlertCircle
      : type === "warning"
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-lg border ${styles}`}
      role={type === "error" ? "alert" : "status"}
    >
      <Icon className={`w-5 h-5 ${iconColor[type]}`} aria-hidden />
      <p className="text-sm">{melding}</p>
    </div>
  );
}

/**
 * Felles loading-UI for hele frontend: spinner og last-visning (sirkel + valgfri tekst).
 * Bruk LoadingSpinner for kun ikon, LoadingView for sentrert boks med spinner og melding.
 */
"use client";

import { Loader2 } from "lucide-react";

const SPINNER_DEFAULT_CLASS =
  "w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin";

export interface LoadingSpinnerProps {
  /** Overstyr størrelse og/eller farge; animate-spin beholdes */
  className?: string;
}

export function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <Loader2
      className={
        className ? `${SPINNER_DEFAULT_CLASS} ${className}`.trim() : SPINNER_DEFAULT_CLASS
      }
    />
  );
}

export interface LoadingViewProps {
  /** Tekst under sirkelen, f.eks. "Laster dashboard..." */
  text?: string;
  /** Full høyde (min-h-full) og bakgrunn – for route loading.tsx. Default true. */
  fullPage?: boolean;
  /** Ekstra CSS på wrapper */
  className?: string;
}

/**
 * Sentrert last-visning: sirkel + valgfri tekst.
 * Brukes av dashboard/loading.tsx, Suspense-fallbacks, seksjonslaster osv.
 */
export function LoadingView({
  text,
  fullPage = true,
  className = "",
}: LoadingViewProps) {
  return (
    <div
      className={
        fullPage
          ? `flex min-h-full items-center justify-center bg-slate-50 p-8 dark:bg-slate-950 ${className}`.trim()
          : `flex flex-1 items-center justify-center p-8 ${className}`.trim()
      }
    >
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner />
        {text ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
        ) : null}
      </div>
    </div>
  );
}

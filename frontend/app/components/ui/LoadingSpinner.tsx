/**
 * LoadingSpinner – felles laste-ikon (Loader2) med standard størrelse og farge.
 * className brukes for å overstyre størrelse/farge; animate-spin beholdes alltid.
 */
"use client";

import { Loader2 } from "lucide-react";

const DEFAULT_CLASS =
  "w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin";

interface LoadingSpinnerProps {
  /** Overstyr størrelse og/eller farge; slås sammen med default, animate-spin beholdes */
  className?: string;
}

export function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <Loader2
      className={className ? `${DEFAULT_CLASS} ${className}`.trim() : DEFAULT_CLASS}
    />
  );
}

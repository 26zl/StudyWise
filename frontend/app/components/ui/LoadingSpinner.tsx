"use client";

import { Loader2 } from "lucide-react";

const DEFAULT_CLASS =
  "w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin";

interface LoadingSpinnerProps {
  /** Override size and/or color; merged with default so animate-spin is always applied */
  className?: string;
}

export function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <Loader2
      className={className ? `${DEFAULT_CLASS} ${className}`.trim() : DEFAULT_CLASS}
    />
  );
}

"use client";

import type { ReactNode } from "react";
import { Loader2, AlertCircle, ShieldCheck } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Shared Clerk error parser                                         */
/* ------------------------------------------------------------------ */

/**
 * Trekk ut lesbar feilmelding fra Clerk-feil.
 * `fallback` bør komme fra i18n (t("auth.genericError")).
 */
export function parseClerkError(
  err: unknown,
  fallback: string,
  translateCode?: (code: string) => string | undefined,
): string {
  if (
    err &&
    typeof err === "object" &&
    "errors" in err &&
    Array.isArray((err as { errors: unknown[] }).errors)
  ) {
    const first = (
      err as { errors: { code?: string; longMessage?: string; message?: string }[] }
    ).errors[0];
    if (first?.code && translateCode) {
      const translated = translateCode(first.code);
      if (translated) return translated;
    }
    return first?.longMessage ?? first?.message ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Shared styling constants                                          */
/* ------------------------------------------------------------------ */

export const AUTH_INPUT_CLASSES =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400 dark:focus:bg-slate-800";

export const AUTH_LABEL_CLASSES =
  "block text-sm font-medium text-slate-700 dark:text-slate-300";

/* ------------------------------------------------------------------ */
/*  AuthCard                                                          */
/* ------------------------------------------------------------------ */

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg dark:border-slate-700 dark:bg-slate-800/95">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthHeader                                                        */
/* ------------------------------------------------------------------ */

export function AuthHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-5 text-center">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthOAuthButtons                                                  */
/* ------------------------------------------------------------------ */

export function AuthOAuthButtons({
  onGoogle,
  onMicrosoft,
  disabled,
}: {
  onGoogle: () => void;
  onMicrosoft: () => void;
  disabled?: boolean;
}) {
  const btnClasses =
    "flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

  return (
    <div className="mb-5 flex gap-3">
      <button
        type="button"
        onClick={onGoogle}
        disabled={disabled}
        className={btnClasses}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Google
      </button>
      <button
        type="button"
        onClick={onMicrosoft}
        disabled={disabled}
        className={btnClasses}
      >
        <svg className="h-4 w-4" viewBox="0 0 23 23">
          <rect x="1" y="1" width="10" height="10" fill="#F25022" />
          <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
          <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
          <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
        </svg>
        Microsoft
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthDivider                                                       */
/* ------------------------------------------------------------------ */

export function AuthDivider({ text }: { text: string }) {
  return (
    <div className="relative mb-5">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-slate-200 dark:border-slate-700" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-white px-3 text-slate-500 dark:bg-slate-800/95 dark:text-slate-400">
          {text}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthError                                                         */
/* ------------------------------------------------------------------ */

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthPrimaryButton                                                 */
/* ------------------------------------------------------------------ */

export function AuthPrimaryButton({
  children,
  loadingText,
  isLoading,
  disabled,
  type = "submit",
  onClick,
}: {
  children: ReactNode;
  loadingText?: string;
  isLoading?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      onClick={onClick}
      className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthFooterLink                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  SecuredByClerk                                                    */
/* ------------------------------------------------------------------ */

/**
 * Liten "Sikret av Clerk"-merke til bunn av custom auth-sider.
 * Clerks ferdige <SignIn/>/<SignUp/> viser denne automatisk, men siden vi
 * bruker custom UI må vi rendre den selv for å gi brukeren samme trygghet.
 */
export function SecuredByClerk({ label }: { label: string }) {
  return (
    <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function AuthFooterLink({
  text,
  linkText,
  href,
}: {
  text: string;
  linkText: string;
  href: string;
}) {
  // Bruker <a> via next/link i konsumenten — dette er en enkel wrapper
  return (
    <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
      {text}{" "}
      <a
        href={href}
        className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {linkText}
      </a>
    </p>
  );
}

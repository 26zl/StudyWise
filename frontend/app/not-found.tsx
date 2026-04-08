/*
 * Global 404-side. Vises av Next.js når en rute ikke matcher.
 * Klient-komponent for å bruke useLanguage() (i18n) — matcher resten av prosjektet.
 */
"use client";

import Link from "next/link";
import { Home, LayoutDashboard } from "lucide-react";
import { useLanguage } from "@/app/i18n";

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          {t("errorPages.notFound.eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {t("errorPages.notFound.title")}
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
          {t("errorPages.notFound.description")}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            <Home className="h-4 w-4" />
            {t("errorPages.notFound.goHome")}
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t("errorPages.notFound.goDashboard")}
          </Link>
        </div>
      </div>
    </main>
  );
}

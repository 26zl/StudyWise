/*
 * Layout for dedikerte Clerk-sider (logg inn / registrer).
 * Felles bakgrunn og «Tilbake til forsiden»-lenke med matchende farger.
 */
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { language } = useLanguage();
  const backLabel = language === "en" ? "Back to home" : "Tilbake til forsiden";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col relative">
      <div className="flex-1 flex flex-col items-center justify-center py-8 px-4">
        <Link
          href="/"
          prefetch={false}
          className="absolute top-4 left-4 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          ← {backLabel}
        </Link>
        {children}
      </div>
    </div>
  );
}

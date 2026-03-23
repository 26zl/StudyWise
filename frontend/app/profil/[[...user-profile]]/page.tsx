/*
 * Clerk UserProfile – redigering av brukerdata, 2FA og tilkoblede kontoer (Google, Microsoft, Apple).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 */
"use client";

import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import { Footer } from "@/app/components/layout/footer";
import { useLanguage } from "@/app/i18n";

export default function ProfilPage() {
  const { language } = useLanguage();
  const backLabel = language === "en" ? "Back to dashboard" : "Tilbake til dashboard";

  return (
    <div className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex-1 px-3 py-4 pb-12 sm:px-4 sm:py-6">
        <div className="mx-auto w-full max-w-4xl min-w-0">
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-flex min-h-11 min-w-11 items-center rounded-lg py-2 text-sm text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:text-white"
          >
            ← {backLabel}
          </Link>
          <div className="mt-4 w-full overflow-x-hidden">
            <UserProfile
              key={language}
              path="/profil"
              routing="path"
              appearance={{
                variables: {
                  colorPrimary: "var(--clerk-color-primary)",
                  colorBackground: "var(--clerk-color-background)",
                  colorForeground: "var(--clerk-color-foreground)",
                  colorMutedForeground: "var(--clerk-color-muted-foreground)",
                  colorMuted: "var(--clerk-color-muted)",
                  colorBorder: "var(--clerk-color-border)",
                  colorInput: "var(--clerk-color-input)",
                  colorInputForeground: "var(--clerk-color-input-foreground)",
                  borderRadius: "0.75rem",
                },
                elements: {
                  rootBox: "w-full max-w-full",
                  card: "w-full max-w-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/95",
                  navbar: "max-sm:w-full",
                  scrollBox: "max-w-full",
                },
              }}
            />
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

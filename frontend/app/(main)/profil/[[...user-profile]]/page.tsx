/*
 * Clerk UserProfile – redigering av brukerdata, 2FA og tilkoblede kontoer (Google, Microsoft, Apple).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 */
"use client";

import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";

export default function ProfilPage() {
  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 py-4 px-3 sm:py-6 sm:px-4 pb-12">
      <div className="max-w-4xl mx-auto w-full min-w-0">
        <Link
          href="/dashboard"
          className="inline-flex items-center min-h-11 min-w-11 py-2 -ml-2 text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-lg"
        >
          ← Tilbake til dashboard
        </Link>
        <div className="mt-4 w-full overflow-x-hidden">
          <UserProfile
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
                card: "w-full max-w-full bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 shadow-sm",
                navbar: "max-sm:w-full",
                scrollBox: "max-w-full",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

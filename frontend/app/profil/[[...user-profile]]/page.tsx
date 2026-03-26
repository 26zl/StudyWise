/*
 * Clerk UserProfile – redigering av brukerdata, 2FA og tilkoblede kontoer (Google, Microsoft, Apple).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 */
"use client";

import { useEffect, useRef } from "react";
import { UserProfile, useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Footer } from "@/app/components/layout/footer";
import { useMeg, useOppdaterProfil } from "@/app/auth/auth-api";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export default function ProfilPage() {
  const { language } = useLanguage();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const { data: meData } = useMeg({ enabled: authLoaded && !!userId });
  const { mutateAsync: oppdaterProfil, isPending: isProfilOppdateringPending } = useOppdaterProfil();
  const sisteSyncForsokRef = useRef<string | null>(null);
  const backLabel = language === "en" ? "Back to dashboard" : "Tilbake til dashboard";

  useEffect(() => {
    if (!clerkUserLoaded || !meData?.user || isProfilOppdateringPending) return;

    const clerkFirstName = normalizeName(clerkUser?.firstName);
    const clerkLastName = normalizeName(clerkUser?.lastName);
    const localFirstName = normalizeName(meData.user.firstName);
    const localLastName = normalizeName(meData.user.lastName);

    const profileUpdate: { firstName?: string; lastName?: string } = {};
    if (clerkFirstName !== localFirstName) profileUpdate.firstName = clerkFirstName;
    if (clerkLastName !== localLastName) profileUpdate.lastName = clerkLastName;

    if (Object.keys(profileUpdate).length === 0) {
      sisteSyncForsokRef.current = null;
      return;
    }

    const syncNokkel = `${localFirstName}|${localLastName}->${clerkFirstName}|${clerkLastName}`;
    if (sisteSyncForsokRef.current === syncNokkel) return;
    sisteSyncForsokRef.current = syncNokkel;

    void oppdaterProfil({ ...profileUpdate, skipClerkSync: true }).catch(() => {
      showToast.warning(
        language === "en" ? "Profile sync failed" : "Profilsynk feilet",
        language === "en"
          ? "Name was updated in profile settings, but could not be synced to StudyWise."
          : "Navn ble oppdatert i profilinnstillinger, men kunne ikke synkes til StudyWise.",
      );
    });
  }, [
    clerkUser?.firstName,
    clerkUser?.lastName,
    clerkUserLoaded,
    isProfilOppdateringPending,
    language,
    meData?.user,
    oppdaterProfil,
  ]);

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

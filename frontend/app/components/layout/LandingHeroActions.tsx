"use client";

/**
 * LandingHeroActions – CTA-knapper under hero-seksjonen på forsiden.
 * Viser hovedknapp til Dashboard og, for ikke-innloggede, sekundærknapp til innlogging/registrering.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { MeResponse } from "common/auth";
import { useAuth } from "@clerk/nextjs";
import { useMeg } from "@/app/auth/auth-api";

interface LandingHeroActionLabels {
  continueToDashboard: string;
  goToDashboard: string;
  signInOrRegister: string;
}

interface LandingHeroActionsProps {
  /** Brukerdata fra server – brukes som initialData for rask første render. Valgfri; ved navigering til forsiden brukes React Query-cache (useMeg). */
  initialUser?: MeResponse | null;
  labels: LandingHeroActionLabels;
}

export function LandingHeroActions({
  initialUser = null,
  labels,
}: LandingHeroActionsProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const megQuery = useMeg({
    initialData: initialUser?.user ? initialUser : undefined,
    enabled: isLoaded && isSignedIn,
  });
  const authAvklart = Boolean(initialUser?.user) || isLoaded;
  const erInnlogget = Boolean(megQuery.data?.user ?? initialUser?.user ?? (isLoaded && isSignedIn));
  const ctaWidth = "min-w-[200px]";

  if (!authAvklart) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <div
          className={`h-14 ${ctaWidth} animate-pulse rounded-full bg-slate-200 dark:bg-slate-800`}
          aria-hidden="true"
        />
        <div
          className={`hidden h-14 ${ctaWidth} animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/70 sm:block`}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
      {/* Primær CTA: innlogget → dashboard, ikke innlogget → auth (logg inn først) */}
      <Link
        href={erInnlogget ? "/dashboard" : "/auth/sign-in"}
        prefetch={false}
        className={`group inline-flex items-center justify-center gap-2 px-8 py-4 ${ctaWidth} bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full font-medium transition-all hover:shadow-lg hover:shadow-blue-500/25`}
      >
        {erInnlogget
          ? labels.continueToDashboard
          : labels.goToDashboard}
        <ArrowRight
          size={18}
          className="group-hover:translate-x-1 transition-transform"
        />
      </Link>
      {/* Sekundær CTA: vis for alle som ikke vises som innlogget – i prod (treg server) vises knappen med én gang, ikke før auth er «avklart» */}
      {!erInnlogget && (
        <Link
          href="/auth/sign-in"
          prefetch={false}
          className={`inline-flex items-center justify-center px-8 py-4 ${ctaWidth} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full font-medium transition-colors`}
        >
          {labels.signInOrRegister}
        </Link>
      )}
    </div>
  );
}

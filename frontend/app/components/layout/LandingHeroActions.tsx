"use client";

/**
 * LandingHeroActions – CTA-knapper under hero-seksjonen på forsiden.
 * Viser hovedknapp til Dashboard og, for ikke-innloggede, sekundærknapp til innlogging/registrering.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { MeResponse } from "common/auth";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { useMeg } from "@/app/auth/auth-api";

/** Safe wrapper for useAuth — returnerer uinnlogget tilstand hvis ClerkProvider ikke er tilgjengelig (f.eks. under SSR etter kontosletting). */
function useSafeAuth(): { isLoaded: boolean; isSignedIn: boolean } {
  try {
    const auth = useAuth();
    return { isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn ?? false };
  } catch {
    return { isLoaded: false, isSignedIn: false };
  }
}

/** Returnerer true hvis QueryClientProvider er tilgjengelig i komponent-treet. */
function useHasQueryClient(): boolean {
  try {
    useQueryClient();
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Indre komponent som bruker useMeg (krever QueryClientProvider).
 * Rendres kun når QueryClientProvider er tilgjengelig.
 */
function LandingHeroActionsInner({
  initialUser,
  labels,
  isLoaded,
  isSignedIn,
}: LandingHeroActionsProps & { isLoaded: boolean; isSignedIn: boolean }) {
  const megQuery = useMeg({
    initialData: initialUser?.user ? initialUser : undefined,
    enabled: isLoaded && isSignedIn,
  });
  const erInnlogget = Boolean(megQuery.data?.user ?? initialUser?.user ?? (isLoaded && isSignedIn));
  return <LandingHeroButtons labels={labels} erInnlogget={erInnlogget} />;
}

export function LandingHeroActions({
  initialUser = null,
  labels,
}: LandingHeroActionsProps) {
  const { isLoaded, isSignedIn } = useSafeAuth();
  const hasQueryClient = useHasQueryClient();

  // Uten QueryClientProvider (f.eks. etter kontosletting + Clerk invalidateCacheAction)
  // rendrer vi med "ikke innlogget"-state basert kun på initialUser/Clerk-auth.
  if (!hasQueryClient) {
    const erInnlogget = Boolean(initialUser?.user ?? (isLoaded && isSignedIn));
    return <LandingHeroButtons labels={labels} erInnlogget={erInnlogget} />;
  }

  return (
    <LandingHeroActionsInner
      initialUser={initialUser}
      labels={labels}
      isLoaded={isLoaded}
      isSignedIn={isSignedIn}
    />
  );
}

function LandingHeroButtons({
  labels,
  erInnlogget,
}: {
  labels: LandingHeroActionLabels;
  erInnlogget: boolean;
}) {
  const ctaWidth = "min-w-[170px]";

  // Vis knappene med én gang — ikke vent på Clerk. Bruk standard «ikke innlogget»-visning
  // frem til auth er avklart. Unngår tom/grå boks på treg lasting (prod/mobil).

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-8 sm:pt-10">
      {/* Primær CTA: innlogget → dashboard, ikke innlogget → auth (logg inn først) */}
      <Link
        href={erInnlogget ? "/dashboard" : "/auth/sign-in"}
        prefetch={false}
        className={`group inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm ${ctaWidth} bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full font-medium transition-all hover:shadow-md hover:shadow-blue-500/25`}
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
          className={`inline-flex items-center justify-center px-5 py-2.5 text-sm ${ctaWidth} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full font-medium transition-colors`}
        >
          {labels.signInOrRegister}
        </Link>
      )}
    </div>
  );
}

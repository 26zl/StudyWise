"use client";

/**
 * LandingHeroActions – CTA-knapper under hero-seksjonen på forsiden.
 * Viser hovedknapp til Dashboard og, for ikke-innloggede, sekundærknapp til innlogging/registrering.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { MeResponse } from "common/auth";
import { useMeg } from "../auth/auth-api";

interface LandingHeroActionsProps {
  /** Brukerdata fra server (f.eks. fra forsidens fetch av /me) – brukes som initialData for rask første render */
  initialUser: MeResponse | null;
  /** True når server så at det ikke var noen auth-cookies – da vet vi at det er gjest og viser «Logg inn» med én gang */
  noCookies?: boolean;
}

export function LandingHeroActions({ initialUser, noCookies }: LandingHeroActionsProps) {
  // Kun bruk server-data som initialData når vi har bekrevet innlogget bruker – aldri null (unngår at transient SSR-feil caches som gjest)
  const megQuery = useMeg({ initialData: initialUser?.user ? initialUser : undefined });
  const erInnlogget = Boolean(megQuery.data?.user ?? initialUser?.user);
  /** Avklart når vi har hentet, er innlogget, har server-data, eller server bekrevet gjest (noCookies) – unngår at «Logg inn» forsvinner et øyeblikk ved refresh */
  const authAvklart =
    megQuery.isFetched ||
    erInnlogget ||
    megQuery.data !== undefined ||
    (noCookies === true && !initialUser?.user);
  const ctaWidth = "min-w-[200px]";

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
      {/* Primær CTA: alltid synlig – går til dashboard (innlogget: "Fortsett", ikke innlogget: "Gå til") */}
      <Link
        href="/dashboard"
        className={`group inline-flex items-center justify-center gap-2 px-8 py-4 ${ctaWidth} bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-full font-medium transition-all hover:shadow-lg hover:shadow-blue-500/25`}
      >
        {erInnlogget ? "Fortsett til Dashboard" : "Gå til Dashboard"}
        <ArrowRight
          size={18}
          className="group-hover:translate-x-1 transition-transform"
        />
      </Link>
      {/* Sekundær CTA: kun for gjester – lenker til innlogging/registrering */}
      {authAvklart && !erInnlogget && (
        <Link
          href="/auth"
          className={`inline-flex items-center justify-center px-8 py-4 ${ctaWidth} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full font-medium transition-colors`}
        >
          Logg inn / Registrer
        </Link>
      )}
    </div>
  );
}

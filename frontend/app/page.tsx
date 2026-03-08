/*
 * Hjemmeside - Velkomstside for applikasjonen
 * Modernisert landingsside med features og value proposition.
 */
import Link from "next/link";
import { Footer } from "./components/footer";
import { BookOpen, Bot, ArrowRight, LayoutDashboard } from "lucide-react";
import { getUserServer } from "./auth/auth-server";

export default async function Hjem() {
  // Vi må verifisere at brukeren faktisk finnes for å unngå "zombie"-sessions
  // der cookie finnes men brukeren er slettet fra backend.
  const userResponse = await getUserServer();
  const erInnlogget = !!userResponse?.user;
  const ctaWidth = "min-w-[200px]";

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">

      {/* Hero Section */}
      <main className="flex-1 flex flex-col">
        <section className="relative px-6 py-24 md:py-32 lg:py-40 overflow-hidden">
          {/* Bakgrunns-effekter */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[62.5rem] h-[31.25rem] bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl -z-10" />

          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight bg-linear-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent pb-4">
              Din intelligente studieassistent
            </h1>
            <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
              StudyWise samler alt du trenger på ett sted. Få full oversikt over Canvas,
              dine kommende oppgaver, og få hjelp av KI til å studere smartere – ikke hardere.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
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
              {!erInnlogget && (
                <Link
                  href="/auth"
                  className={`inline-flex items-center justify-center px-8 py-4 ${ctaWidth} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full font-medium transition-colors`}
                >
                  Logg inn / Registrer
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="px-6 py-16 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">

            {/* Feature 1: Canvas */}
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center mb-6">
                <BookOpen size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">Sømløs Canvas-integrasjon</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Koble til Canvas én gang og få tilgang til alle dine emner, moduler, filer
                og kunngjøringer direkte i dashboardet.
              </p>
            </div>

            {/* Feature 2: Dashboard */}
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center mb-6">
                <LayoutDashboard size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">Total Oversikt</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Se alt som skjer i dag og de neste dagene. Dine personlige gjøremål og
                frister fra skolen samlet på ett sted.
              </p>
            </div>

            {/* Feature 3: KI Assistent */}
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mb-6">
                <Bot size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">KI-Studiepartner</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Står du fast? Få umiddelbar hjelp, forklaringer og studietips fra din
                personlige KI-assistent.
              </p>
            </div>

          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

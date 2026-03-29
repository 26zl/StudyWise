/*
 * Forside – velkomstside for applikasjonen.
 * Henter bruker trygt på serveren slik at innloggede brukere ikke ser gjeste-CTAer
 * i et kort øyeblikk ved refresh før Clerk er hydrert i klienten.
 */
import { Footer } from "@/app/components/layout/footer";
import { BookOpen, Bot, LayoutDashboard } from "lucide-react";
import { LandingHeroActions } from "@/app/components/layout/LandingHeroActions";
import { getUserServerSafe } from "@/app/auth/auth-server";
import { translate } from "@/app/i18n";
import { resolveRequestLanguage } from "@/app/i18n/server";

export default async function HomePage() {
  const language = await resolveRequestLanguage();
  const initialUser = await getUserServerSafe();

  return (
    <div className="min-h-full flex flex-col bg-white text-slate-900 transition-colors dark:bg-slate-900 dark:text-slate-100">
      <main className="flex-1 flex flex-col">
        <section className="relative px-4 sm:px-6 lg:px-8 py-24 md:py-32 lg:py-40 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-250 h-125 bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl -z-10" />
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight bg-linear-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent pb-4">
              {translate(language, "landing.hero.title")}
            </h1>
            <p className="text-lg md:text-xl text-slate-700 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
              {translate(language, "landing.hero.description")}
            </p>
            <LandingHeroActions
              initialUser={initialUser}
              labels={{
                continueToDashboard: translate(language, "landing.actions.continueToDashboard"),
                goToDashboard: translate(language, "common.actions.goToDashboard"),
                signInOrRegister: translate(language, "landing.actions.signInOrRegister"),
              }}
            />
          </div>
        </section>
        <section className="px-4 sm:px-6 lg:px-8 py-16 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800" aria-labelledby="funksjoner-heading">
          <h2 id="funksjoner-heading" className="sr-only">
            {translate(language, "landing.features.heading")}
          </h2>
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center mb-6">
                <BookOpen size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">
                {translate(language, "landing.features.canvasIntegration.title")}
              </h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {translate(language, "landing.features.canvasIntegration.description")}
              </p>
            </div>
            <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center mb-6">
                <LayoutDashboard size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">
                {translate(language, "landing.features.overview.title")}
              </h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {translate(language, "landing.features.overview.description")}
              </p>
            </div>
            <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mb-6">
                <Bot size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">
                {translate(language, "landing.features.aiPartner.title")}
              </h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {translate(language, "landing.features.aiPartner.description")}
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

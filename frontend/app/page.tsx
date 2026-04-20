/*
 * Forside – velkomstside for applikasjonen.
 * Henter bruker trygt på serveren slik at innloggede brukere ikke ser gjeste-CTAer
 * i et kort øyeblikk ved refresh før Clerk er hydrert i klienten.
 */
import { Footer } from "@/app/components/layout/footer";
import {
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { LandingHeroActions } from "@/app/components/layout/LandingHeroActions";
import { getUserServerSafe } from "@/app/auth/auth-server";
import { translate } from "@/app/i18n";
import { resolveRequestLanguage } from "@/app/i18n/server";

function splitHeading(text: string): { lead: string; accent: string } {
  const trimmed = text.trim();
  const splitIndex = trimmed.lastIndexOf(" ");

  if (splitIndex === -1) {
    return { lead: trimmed, accent: "" };
  }

  return {
    lead: trimmed.slice(0, splitIndex),
    accent: trimmed.slice(splitIndex + 1),
  };
}

export default async function HomePage() {
  const language = await resolveRequestLanguage();
  const initialUser = await getUserServerSafe();

  const heroHeading = splitHeading(translate(language, "landing.hero.title"));
  const featureHeading = splitHeading(translate(language, "landing.features.heading"));

  const headingClass =
    "font-bold tracking-tight text-slate-900 dark:text-white";

  const featureCards = [
    {
      icon: BookOpen,
      iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
      title: translate(language, "landing.features.canvasIntegration.title"),
      description: translate(language, "landing.features.canvasIntegration.description"),
    },
    {
      icon: LayoutDashboard,
      iconBg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300",
      title: translate(language, "landing.features.overview.title"),
      description: translate(language, "landing.features.overview.description"),
    },
    {
      icon: Bot,
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
      title: translate(language, "landing.features.aiPartner.title"),
      description: translate(language, "landing.features.aiPartner.description"),
    },
    {
      icon: CalendarDays,
      iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
      title: translate(language, "landing.features.smartCalendar.title"),
      description: translate(language, "landing.features.smartCalendar.description"),
    },
    {
      icon: BellRing,
      iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
      title: translate(language, "landing.features.announcements.title"),
      description: translate(language, "landing.features.announcements.description"),
    },
    {
      icon: Sparkles,
      iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
      title: translate(language, "landing.features.personalStudyPlan.title"),
      description: translate(language, "landing.features.personalStudyPlan.description"),
    },
  ];

  return (
    <div className="relative min-h-full flex flex-col text-slate-900 transition-colors dark:text-slate-100 overflow-x-hidden">
      <main className="relative flex-1 flex flex-col">
        <section className="relative px-4 sm:px-6 lg:px-8 pt-20 pb-8 md:pt-28 md:pb-12">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <h1 className={`${headingClass} text-4xl sm:text-5xl md:text-6xl text-balance`}>
              {heroHeading.lead}
              {heroHeading.accent ? (
                <>
                  {" "}
                  <span className="bg-linear-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
                    {heroHeading.accent}
                  </span>
                </>
              ) : null}
            </h1>
            <p className="text-sm sm:text-base md:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed text-balance">
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

        <section className="px-4 sm:px-6 lg:px-8 py-8 md:py-10" aria-labelledby="funksjoner-heading">
          <div className="max-w-5xl mx-auto text-center">
            <h2 id="funksjoner-heading" className={`${headingClass} text-3xl sm:text-4xl text-balance`}>
              {featureHeading.lead}
              {featureHeading.accent ? (
                <>
                  {" "}
                  <span className="bg-linear-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
                    {featureHeading.accent}
                  </span>
                </>
              ) : null}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-balance">
              {translate(language, "landing.features.subheading")}
            </p>
          </div>

          <div className="max-w-5xl mx-auto mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            {featureCards.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="group rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/85 dark:bg-slate-900/45 backdrop-blur-sm p-5 shadow-[0_1px_2px_rgb(15_23_42/0.06)] hover:shadow-[0_10px_28px_rgb(15_23_42/0.08)] dark:shadow-none transition-all"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${feature.iconBg}`}>
                    <Icon size={18} />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white text-left">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-left">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

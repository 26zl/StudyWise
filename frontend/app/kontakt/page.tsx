/*
 * Kontakt - Kontaktinformasjon og kontaktskjema for StudyWise
 */
import { Github, Mail, MessageSquare, School } from "lucide-react";
import { InfoCard, InfoPageLayout } from "@/app/components/layout/InfoPageLayout";
import { ContactForm } from "./ContactForm";

export default function KontaktPage() {
  const kontaktpunkter = [
    {
      icon: MessageSquare,
      title: "Tilbakemeldinger",
      description:
        "Vi setter pris på alle tilbakemeldinger som kan hjelpe oss å forbedre StudyWise. Del gjerne dine tanker og forslag.",
      accent:
        "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    },
    {
      icon: Github,
      title: "Feilrapportering",
      description:
        "Har du funnet en feil? Rapporter den slik at vi kan fikse den. Inkluder gjerne skjermbilder og steg for å reprodusere feilen.",
      accent: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    },
    {
      icon: School,
      title: "Universitetet i Sør-Øst-Norge",
      description:
        "StudyWise er et bachelorprosjekt ved USN, Institutt for IT og informasjonssystemer.",
      accent: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    },
  ];

  return (
    <InfoPageLayout
      title="Kontakt oss"
      description="Har du spørsmål, tilbakemeldinger eller trenger hjelp? Send oss en melding."
    >
      {/* Kontaktskjema */}
      <InfoCard className="mb-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">
              Send oss en melding
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              E-post: kontakt@studwize.page
            </p>
          </div>
        </div>
        <ContactForm />
      </InfoCard>

      {/* Andre kontaktpunkter */}
      <div className="grid gap-4">
        {kontaktpunkter.map((kontaktpunkt) => (
          <InfoCard key={kontaktpunkt.title} className="flex gap-4">
            <div className={`h-fit rounded-lg p-2 ${kontaktpunkt.accent}`}>
              <kontaktpunkt.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">
                {kontaktpunkt.title}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {kontaktpunkt.description}
              </p>
            </div>
          </InfoCard>
        ))}
      </div>

    </InfoPageLayout>
  );
}

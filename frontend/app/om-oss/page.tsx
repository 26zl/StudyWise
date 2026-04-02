/*
 * Om oss - Informasjon om StudyWise
 */
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function OmOssPage() {
  return (
    <InfoPageLayout title="Om StudyWise">
      <InfoSection title="Hva er StudyWise?">
        <p>
          StudyWise er en AI-drevet studieassistent utviklet som et bachelorprosjekt
          ved Universitetet i Sør-Øst-Norge (USN). Applikasjonen integrerer med
          Canvas LMS for å gi studenter en sentralisert plattform for å holde
          oversikt over studiene sine.
        </p>
      </InfoSection>

      <InfoSection title="Funksjoner">
        <ul className="space-y-3">
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Canvas-integrasjon:</strong> Se kunngjøringer, emner, frister og
              kalender fra Canvas
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>AI-assistent:</strong> Få hjelp med studier, oppgaver og spørsmål
              om Canvas-innhold
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Kalender:</strong> Oversikt over alle frister og hendelser på ett
              sted
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Dokumentanalyse:</strong> Last opp PDF, Word, bilder og andre filer
              for AI-analyse og oppsummering
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Oppgavenedbrytning:</strong> AI bryter ned store oppgaver i
              håndterbare deloppgaver
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Arbeidsplan:</strong> Generer ukentlige studieplaner tilpasset
              dine frister
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-500 dark:text-blue-400">•</span>
            <span>
              <strong>Samtalehistorikk:</strong> Lagre og fortsett samtaler med AI-en
            </span>
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Teamet">
        <p>
          StudyWise er utviklet av studenter ved USN som en del av deres
          bacheloroppgave i IT og informasjonssystemer. Prosjektet fokuserer på å
          utforske hvordan AI kan forbedre studieopplevelsen for studenter.
        </p>
      </InfoSection>

      <InfoSection title="Teknologi">
        <p className="mb-4">Applikasjonen er bygget med moderne teknologier:</p>
        <div className="flex flex-wrap gap-2">
          {["Next.js", "React", "TypeScript", "Tailwind CSS", "Express", "MongoDB", "Redis", "Clerk", "Claude (Anthropic)", "Pinecone", "Cohere", "Datadog", "Cloudflare"].map((tech) => (
            <span
              key={tech}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {tech}
            </span>
          ))}
        </div>
      </InfoSection>
    </InfoPageLayout>
  );
}

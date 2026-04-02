import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

const sporsmal = [
  {
    kategori: "Canvas",
    items: [
      {
        q: "Hvordan får jeg Canvas API-token?",
        a: (
          <>
            Logg inn på Canvas, gå til <strong>Innstillinger → Godkjente integrasjoner</strong>, og
            klikk &quot;Ny tilgangstoken&quot;. Kopier tokenet og lim det inn i StudyWise under
            Innstillinger.
          </>
        ),
      },
      {
        q: "Hvilke Canvas-institusjoner støttes?",
        a: "StudyWise støtter Canvas-installasjoner ved norske universiteter og høgskoler. Velg institusjonen din når du kobler til Canvas.",
      },
    ],
  },
  {
    kategori: "Sikkerhet og personvern",
    items: [
      {
        q: "Er dataene mine trygge?",
        a: (
          <>
            Ja, alle sensitive data krypteres med AES-256-GCM. Les mer på vår{" "}
            <Link href="/sikkerhet" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
              sikkerhetsside
            </Link>
            .
          </>
        ),
      },
      {
        q: "Sender StudyWise data til tredjepart?",
        a: (
          <>
            Samtaler sendes til Anthropic (Claude) for AI-svar. Canvas-data hentes kun fra din
            institusjon. Les vår{" "}
            <Link href="/personvern" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
              personvernerklæring
            </Link>{" "}
            for detaljer.
          </>
        ),
      },
    ],
  },
  {
    kategori: "Konto",
    items: [
      {
        q: "Hvordan sletter jeg kontoen min?",
        a: (
          <>
            Gå til Innstillinger eller{" "}
            <Link href="/kontakt" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
              kontakt oss
            </Link>{" "}
            for å be om kontosletting. Kontoopplysninger og tilknyttede data slettes eller
            anonymiseres, mens begrensede sikkerhets- og revisjonslogger kan beholdes i
            pseudonymisert form i en begrenset periode.
          </>
        ),
      },
      {
        q: "Kan jeg bruke StudyWise uten Canvas-token?",
        a: "Ja, du kan bruke KI-chatten og dokumentanalyse uten å koble til Canvas. Canvas-token er kun nødvendig for å hente kursdata, oppgaver og kalender.",
      },
    ],
  },
  {
    kategori: "Funksjoner",
    items: [
      {
        q: "Hvilke filtyper støttes for dokumentanalyse?",
        a: "StudyWise støtter PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), bilder (PNG, JPG, WEBP) og vanlige kodefiler.",
      },
      {
        q: "Hvor lenge lagres delte samtaler?",
        a: "Delte samtalelenker er gyldige i 30 dager. Etter det slettes den delte lenken automatisk.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <InfoPageLayout
      title="Ofte stilte spørsmål"
      description="Finn svar på de vanligste spørsmålene om StudyWise."
    >
      {sporsmal.map((gruppe) => (
        <InfoSection key={gruppe.kategori} title={gruppe.kategori}>
          <div className="space-y-5">
            {gruppe.items.map((item) => (
              <div key={item.q}>
                <h3 className="mb-1 font-medium text-slate-900 dark:text-white">{item.q}</h3>
                <p className="text-sm leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </InfoSection>
      ))}

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Fant du ikke svaret?{" "}
        <Link href="/kontakt" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
          Kontakt oss
        </Link>
        .
      </p>
    </InfoPageLayout>
  );
}

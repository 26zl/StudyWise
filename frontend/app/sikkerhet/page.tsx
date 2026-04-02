/*
 * Sikkerhet - Sikkerhetsinformasjon for StudyWise
 */
import Link from "next/link";
import {
  Code2,
  Cookie,
  ExternalLink,
  Eye,
  Github,
  Key,
  Lock,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { InfoCard, InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function SikkerhetPage() {
  const sikkerhetsTiltak = [
    {
      icon: Lock,
      title: "Kryptering",
      description:
        "Alle sensitive data krypteres med AES-256-GCM for lagring. Innlogging og passord håndteres av Clerk; vi lagrer ikke passord selv. Clerk støtter 2FA og sikker lagring.",
    },
    {
      icon: Key,
      title: "Sikker tokenhandtering",
      description:
        "Canvas API-tokens lagres kryptert og brukes kun server-side. De eksponeres aldri til nettleseren eller tredjeparter.",
    },
    {
      icon: Shield,
      title: "HTTPS og sikkerhetsheadere",
      description:
        "All kommunikasjon skjer over TLS. Vi bruker Helmet for sikkerhetsheadere (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Content-Security-Policy i produksjon).",
    },
    {
      icon: ShieldCheck,
      title: "CSRF-beskyttelse",
      description:
        "State-endrende forespørsler (POST, PUT, PATCH, DELETE) krever en gyldig CSRF-header og at forespørselen kommer fra vår egen nettside, for å forhindre tredjepartsider i å utføre handlinger på dine vegne.",
    },
    {
      icon: Zap,
      title: "Rate limiting",
      description:
        "Vi begrenser antall forespørsler per IP og per tjeneste (innlogging, KI, Canvas, API-token). Det reduserer risiko for misbruk og brute-force-angrep.",
    },
    {
      icon: Cookie,
      title: "Sikre sesjoner (Clerk)",
      description:
        "Innlogging og sesjoner håndteres av Clerk med sikre cookies (httpOnly, secure, sameSite). Clerk støtter to-faktor (2FA) og innlogging med Google og Microsoft. Tilgangstoken har kort levetid og sendes kun over HTTPS.",
    },
    {
      icon: Eye,
      title: "Minimalt datainnsyn",
      description:
        "Vi henter kun data fra Canvas som er nødvendig for funksjonaliteten du bruker. Se vår personvernerklæring for hvordan vi behandler data.",
    },
    {
      icon: Server,
      title: "Sikker infrastruktur",
      description:
        "Applikasjonen kjører på sikre plattformer (Vercel, Heroku) med brannmur og tilgangskontroll. Cloudflare brukes som CDN med bot-beskyttelse (Turnstile) og DNS-sikkerhet.",
    },
    {
      icon: RefreshCw,
      title: "Automatisk utlogging",
      description:
        "Sesjoner utløper automatisk. Ved inaktivitet eller utløpt sesjon må du logge inn på nytt. Clerk håndterer sesjon og valgfri to-faktor.",
    },
  ];

  return (
    <InfoPageLayout
      title="Sikkerhet"
      description="Sikkerheten til dine data er vår høyeste prioritet."
    >
      <div className="grid gap-4">
        {sikkerhetsTiltak.map((tiltak) => (
          <InfoCard key={tiltak.title} className="flex gap-4">
            <div className="h-fit rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
              <tiltak.icon className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">
                {tiltak.title}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {tiltak.description}
              </p>
            </div>
          </InfoCard>
        ))}
      </div>

      <InfoSection title="Canvas API-sikkerhet">
        <p className="mb-4">
          Når du kobler til Canvas, bruker vi ditt personlige API-token:
        </p>
        <ul className="space-y-2 text-sm">
          <li>• Vi bruker tokenet kun til å lese dine Canvas-data — vi utfører ingen skriveoperasjoner</li>
          <li>• Du kan tilbakekalle tokenet i Canvas når som helst</li>
          <li>• Tokenet lagres kryptert og sendes aldri til tredjeparter</li>
        </ul>
      </InfoSection>

      <InfoSection title="Logging og personvern">
        <p>
          På serveren logger vi feil og sikkerhetshendelser for drift og
          feilsøking. Vi logger ikke e-post, navn, passord, Canvas-token eller
          brukerinnhold (f.eks. chat-meldinger og søketekst) i produksjon. Vi kan
          lagre begrenset teknisk metadata som pseudonymisert bruker-ID,
          IP-adresse, user-agent og request-id for sikkerhet, misbruksdeteksjon og
          hendelseshåndtering. Revisjonslogger har begrenset lagringstid og
          anonymiseres ved kontosletting der det er mulig.
        </p>
      </InfoSection>

      <InfoSection title="AI og personvern">
        <p className="mb-4">Når du bruker AI-assistenten:</p>
        <ul className="space-y-2 text-sm">
          <li>
            • Personlig identifiserbar informasjon unngås eller fjernes før
            sending til AI-tjenesten
          </li>
          <li>• Canvas-innhold anonymiseres der det er mulig</li>
          <li>
            • Samtaler lagres kryptert på din konto; en kort tittel fra første
            spørsmål lagres for visning i listen
          </li>
          <li>• Du kan slette samtalehistorikken eller enkelt samtaler når som helst</li>
        </ul>
        <p className="mt-4 text-sm">
          Mer om behandling av personopplysninger finner du i vår{" "}
          <Link href="/personvern" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
            personvernerklæring
          </Link>
          .
        </p>
      </InfoSection>

      <InfoSection title="Åpen kildekode og transparens">
        <div className="mb-4 flex items-start gap-3">
          <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-600 dark:text-slate-400" />
          <p>
            StudyWise er et åpen kildekode-prosjekt. Vi tror på transparens som
            grunnlag for tillit — all kildekode er offentlig tilgjengelig slik at
            hvem som helst kan verifisere hvordan vi behandler data, hvilke
            sikkerhetsmekanismer vi bruker, og at vi holder det vi lover.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/26zl/StudyWise"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Github className="h-4 w-4" />
            Se kildekoden på GitHub
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
          <a
            href="https://www.virustotal.com/gui/domain/studwize.page"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
          >
            <ShieldCheck className="h-4 w-4" />
            VirusTotal-rapport
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Vi kjører automatisk CI/CD med sikkerhetsskanning (TruffleHog, OWASP,
          SAST), avhengighetsrevisjoner og SBOM-generering ved hver utrulling.
        </p>
      </InfoSection>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
        <h2 className="mb-2 text-lg font-semibold text-amber-800 dark:text-amber-200">
          Rapporter sikkerhetsproblemer
        </h2>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Har du oppdaget en sikkerhetssvakhet? Kontakt oss umiddelbart via{" "}
          <Link href="/kontakt" prefetch={false} className="underline hover:no-underline">
            kontaktskjemaet
          </Link>
          . Vi tar alle rapporter på alvor og vil respondere raskt.
        </p>
      </section>
    </InfoPageLayout>
  );
}

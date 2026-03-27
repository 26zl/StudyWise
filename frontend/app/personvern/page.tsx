/*
 * Personvern - Personvernerklæring for StudyWise
 */
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function PersonvernPage() {
  return (
    <InfoPageLayout title="Personvernerklæring" updatedAt="Mars 2026">
      <InfoSection title="Hvilke data samler vi inn?">
        <ul className="space-y-3">
          <li>
            <strong>Kontoinformasjon og innlogging:</strong> Innlogging håndteres av
            Clerk (e-post, passord og valgfri to-faktor). Du kan koble til Google,
            Microsoft eller Apple hvis det er aktivert. Vi lagrer ikke passord selv;
            Clerk håndterer sikkerhet og 2FA.
          </li>
          <li>
            <strong>Informasjonskapsler (cookies) og monitorering:</strong> Vi bruker
            nødvendige cookies for innlogging og preferanser. I tillegg bruker vi
            driftsmonitorering og feilsporing for å kunne knytte feil til
            backend/APM og følge stabiliteten i løsningen. Hvis du godtar det,
            aktiverer vi også valgfrie ytelsesmålinger. Valget for valgfrie
            målinger lagres lokalt i nettleseren.
          </li>
          <li>
            <strong>Canvas API-token:</strong> Lagres kryptert (AES-256-GCM) for å
            hente dine Canvas-data på dine vegne.
          </li>
          <li>
            <strong>Samtalehistorikk:</strong> AI-samtaler lagres kryptert på din
            konto. Vi lagrer en kort tittel basert på første spørsmål (f.eks. første
            50 tegn) for å vise samtalen i listen.
          </li>
          <li>
            <strong>Preferanser og varsler:</strong> Dine valg for Canvas-kontekst og
            varsler (f.eks. lest/kunngjøringer) lagres knyttet til kontoen din.
          </li>
          <li>
            <strong>Canvas-cache:</strong> Vi cacher midlertidig data fra Canvas
            (emner, oppgaver, kalender) for bedre ytelse. Cache lagres kun kort tid
            (minutter til timer).
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Behandlingsgrunnlag (GDPR Art. 6)">
        <p className="mb-3">
          Vi behandler personopplysninger på følgende rettslige grunnlag:
        </p>
        <ul className="space-y-3">
          <li>
            <strong>Avtale — Art. 6(1)(b):</strong> Kontoinformasjon (e-post,
            innlogging via Clerk), Canvas API-token, samtalehistorikk, preferanser
            og arbeidsplaner behandles fordi det er nødvendig for å levere
            tjenesten du har registrert deg for.
          </li>
          <li>
            <strong>Berettiget interesse — Art. 6(1)(f):</strong> Sikkerhetslogging,
            revisjonslogg, driftsmonitorering (Datadog APM/RUM) og
            misbruksdeteksjon behandles på grunnlag av vår berettigede interesse
            i sikker og stabil drift. Disse dataene er minimert og
            pseudonymisert der det er mulig.
          </li>
          <li>
            <strong>Samtykke — Art. 6(1)(a):</strong> Valgfrie ytelsesmålinger
            (f.eks. Speed Insights) aktiveres kun dersom du eksplisitt godtar
            dette via cookie-banneret. Du kan når som helst trekke tilbake
            samtykket ved å endre valget i innstillingene dine. Hvis du ikke er
            innlogget, gjelder valget bare for den åpne økten.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Formål med behandlingen">
        <p className="mb-3">Vi bruker dataene for å:</p>
        <ul className="space-y-3">
          <li>
            Gi deg tilgang til Canvas-informasjon (emner, oppgaver, kunngjøringer,
            kalender) i appen.
          </li>
          <li>
            La AI-assistenten svare på spørsmål om dine emner og oppgaver (med
            anonymisert/redusert kontekst der det er mulig).
          </li>
          <li>Lagre samtalehistorikk slik at du kan fortsette tidligere samtaler.</li>
          <li>Huske dine preferanser og varsler-innstillinger på tvers av enheter.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Lagringstid">
        <ul className="space-y-3">
          <li>
            <strong>Konto og profil:</strong> Inntil du sletter kontoen. Ved
            kontosletting slettes eller anonymiseres kontoopplysninger, Canvas-token,
            samtalehistorikk, preferanser og arbeidsplaner. Begrensede sikkerhets- og
            revisjonslogger kan beholdes i pseudonymisert eller minimert form i opptil
            24 måneder.
          </li>
          <li>
            <strong>Samtalehistorikk:</strong> Lagres til du sletter en samtale eller
            hele historikken, eller til du sletter kontoen.
          </li>
          <li>
            <strong>Canvas-cache:</strong> Kortvarig (typisk 5–30 minutter). Cachen
            slettes eller overskrives automatisk og inneholder ikke persistert
            personidentifiserbar data utover det som trengs for å vise dine sider.
          </li>
          <li>
            <strong>Sesjoner:</strong> Innlogging og sesjoner håndteres av Clerk.
            Session-token utløper etter Clerk sin konfigurasjon og oppdateres av
            innloggingsleverandøren ved behov.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Informasjonskapsler (cookies)">
        <p>
          Vi bruker nødvendige informasjonskapsler for innlogging (Clerk), for å
          huske tema og preferanser, og for at appen skal fungere korrekt. Vi bruker
          også nødvendig driftsmonitorering og feilsporing for å kunne koble
          frontend-feil til monitorering og backend-spor. Hvis du godtar det,
          aktiverer vi i tillegg valgfrie ytelsesmålinger (for eksempel Speed
          Insights). Ved første besøk vises en melding nederst på siden der du kan
          velge <strong>Kun nødvendige</strong> eller <strong>Godta alle</strong>.
          For innloggede brukere lagres valget på brukerprofilen din i databasen og
          brukes ikke til markedsføring. Hvis du ikke er innlogget, huskes valget
          bare for den åpne nettleserøkten.
        </p>
      </InfoSection>

      <InfoSection title="Deling med tredjeparter">
        <p className="mb-4">Vi deler minimalt med tredjeparter:</p>
        <ul className="space-y-3">
          <li>
            <strong>AI-tjenester (Anthropic):</strong> Innhold du skriver og kontekst
            (f.eks. oppgavetekst) sendes til AI for å generere svar. Vi unngår å
            sende personidentifiserbar informasjon (navn, e-post) til AI;
            Canvas-innhold anonymiseres der det er mulig.
          </li>
          <li>
            <strong>Canvas LMS:</strong> Vi bruker kun ditt API-token for å hente data
            på dine vegne mot din institusjons Canvas. Tokenet lagres kryptert hos
            oss og sendes ikke til andre tredjeparter.
          </li>
          <li>
            <strong>Monitorering (Datadog):</strong> Tekniske drifts- og
            feilsporingsdata kan behandles av Datadog for å knytte frontend-feil,
            backend-spor og ytelsesavvik sammen. Dette omfatter tekniske metadata,
            ikke innholdet i Canvas-token eller chat-meldinger.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Dine rettigheter (GDPR)">
        <p className="mb-4">
          Du har rett til innsyn, retting, sletting og dataportabilitet:
        </p>
        <ul className="space-y-3">
          <li>
            <strong>Innsyn:</strong> Du kan be om oversikt over hvilke data vi har
            lagret om deg. Kontakt oss via kontaktskjemaet.
          </li>
          <li>
            <strong>Retting:</strong> Du kan oppdatere e-post, passord og to-faktor
            under Innstillinger → Konto og sikkerhet (rediger profil). Canvas-token og
            preferanser kan du endre eller fjerne under innstillinger.
          </li>
          <li>
            <strong>Sletting:</strong> Du kan slette enkelt samtaler eller hele
            chat-historikken i appen, og slette Canvas-token under innstillinger.
            Full kontosletting kan gjøres under innstillinger eller ved å kontakte
            oss. Da slettes eller anonymiseres kontoopplysninger og tilknyttede data,
            mens begrensede sikkerhets- og revisjonslogger kan beholdes i
            pseudonymisert form i en begrenset periode.
          </li>
          <li>
            <strong>Dataportabilitet:</strong> Du kan be om eksport av dine data
            (f.eks. samtalehistorikk). Kontakt oss via kontaktskjemaet.
          </li>
        </ul>
        <p className="mt-4">
          Du kan også klage til Datatilsynet dersom du mener behandlingen bryter
          personvernlovgivningen.
        </p>
      </InfoSection>

      <InfoSection title="Lagring og sikkerhet">
        <ul className="space-y-3">
          <li>
            Sensitive data (Canvas-token, samtalehistorikk) krypteres med AES-256-GCM
            før lagring.
          </li>
          <li>
            Innlogging og passord håndteres av Clerk; vi lagrer ikke passord selv.
            Clerk støtter to-faktor (2FA) og tilkobling til Google, Microsoft og
            Apple.
          </li>
          <li>
            Sikkerhets- og revisjonslogger minimeres og pseudonymiseres ved
            kontosletting der det er praktisk mulig, men enkelte tekniske metadata kan
            beholdes i begrenset tid for sikkerhet, misbruksdeteksjon og etterlevelse.
          </li>
          <li>
            Data lagres på sikre servere med tilgangskontroll. Se også vår{" "}
            <Link href="/sikkerhet" prefetch={false} className="text-blue-500 hover:underline">
              sikkerhetsside
            </Link>
            .
          </li>
          <li>All kommunikasjon mellom nettleser og servere skjer over HTTPS.</li>
          <li>Canvas-cache har kort levetid og slettes/roteres automatisk.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Kontakt">
        <p>
          Har du spørsmål om personvern eller vil utøve rettighetene dine? Kontakt
          oss via{" "}
          <Link href="/kontakt" prefetch={false} className="text-blue-500 hover:underline">
            kontaktskjemaet
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}

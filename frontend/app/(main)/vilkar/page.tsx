/*
 * Vilkår - Brukervilkar for StudyWise
 */
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function VilkarPage() {
  return (
    <InfoPageLayout title="Brukervilkår" updatedAt="Januar 2026">
      <InfoSection title="1. Aksept av vilkår">
        <p>
          Ved å opprette en konto og bruke StudyWise aksepterer du disse
          brukervilkårene. Hvis du ikke aksepterer vilkårene, må du ikke bruke
          tjenesten.
        </p>
      </InfoSection>

      <InfoSection title="2. Beskrivelse av tjenesten">
        <p>
          StudyWise er en studieassistent som integrerer med Canvas LMS og tilbyr
          AI-basert hjelp. Tjenesten er utviklet som et bachelorprosjekt ved USN
          og tilbys gratis til studenter.
        </p>
      </InfoSection>

      <InfoSection title="3. Brukerkonto">
        <ul className="space-y-2">
          <li>• Du er ansvarlig for å holde passordet ditt hemmelig</li>
          <li>• Du må ikke dele kontoen din med andre</li>
          <li>• Du må varsle oss umiddelbart ved mistanke om uautorisert tilgang</li>
          <li>• Vi kan suspendere kontoer som bryter vilkårene</li>
        </ul>
      </InfoSection>

      <InfoSection title="4. Canvas-integrasjon">
        <ul className="space-y-2">
          <li>• Du gir oss tillatelse til å hente data fra Canvas på dine vegne</li>
          <li>• Vi henter kun data som er nødvendig for tjenestens funksjonalitet</li>
          <li>• Du kan tilbakekalle tilgangen når som helst via Canvas</li>
          <li>• Vi er ikke ansvarlige for innhold i Canvas</li>
        </ul>
      </InfoSection>

      <InfoSection title="5. AI-assistenten">
        <ul className="space-y-2">
          <li>• AI-svarene er veiledende og kan inneholde feil</li>
          <li>• Du bør alltid verifisere viktig informasjon</li>
          <li>• AI-en skal ikke brukes til juks eller akademisk uredelighet</li>
          <li>• Vi forbeholder oss retten til å moderere innhold</li>
        </ul>
      </InfoSection>

      <InfoSection title="6. Akseptabel bruk">
        <p className="mb-3">Du må ikke:</p>
        <ul className="space-y-2">
          <li>• Bruke tjenesten til ulovlige formål</li>
          <li>• Forsøke å få uautorisert tilgang til systemer</li>
          <li>• Overbelaste tjenesten med unødvendige forspørsler</li>
          <li>• Dele innhold som krenker andres rettigheter</li>
        </ul>
      </InfoSection>

      <InfoSection title="7. Ansvarsfraskrivelse">
        <p>
          Tjenesten tilbys &quot;som den er&quot; uten garantier. Vi er ikke ansvarlige
          for tap eller skade som følge av bruk av tjenesten. Dette inkluderer,
          men er ikke begrenset til, tap av data, feil i AI-svar, eller nedetid.
        </p>
      </InfoSection>

      <InfoSection title="8. Endringer i vilkårene">
        <p>
          Vi kan oppdatere disse vilkårene. Vesentlige endringer vil varsles via
          e-post eller i appen. Fortsatt bruk etter endringer innebarer aksept av
          de nye vilkårene.
        </p>
      </InfoSection>

      <InfoSection title="9. Kontakt">
        <p>
          Spørsmål om vilkårene kan rettes til oss via{" "}
          <Link href="/kontakt" prefetch={false} className="text-blue-500 hover:underline">
            kontaktskjemaet
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}

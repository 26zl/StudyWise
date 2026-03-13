/*
 * Vilkår - Brukervilkar for StudyWise
 */
import Link from "next/link";
import { Footer } from "@/app/components/layout/footer";

export default function VilkarPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
            <div className="flex-1 w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <Link
                    href="/"
                    className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-8"
                >
                    ← Tilbake til forsiden
                </Link>

                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Brukervilkår
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
                    Sist oppdatert: Januar 2026
                </p>

                <div className="space-y-6">
                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            1. Aksept av vilkår
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Ved å opprette en konto og bruke StudyWise aksepterer du disse brukervilkårene.
                            Hvis du ikke aksepterer vilkårene, må du ikke bruke tjenesten.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            2. Beskrivelse av tjenesten
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            StudyWise er en studieassistent som integrerer med Canvas LMS og tilbyr
                            AI-basert hjelp. Tjenesten er utviklet som et bachelorprosjekt ved USN
                            og tilbys gratis til studenter.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            3. Brukerkonto
                        </h2>
                        <ul className="space-y-2 text-slate-600 dark:text-slate-400">
                            <li>• Du er ansvarlig for å holde passordet ditt hemmelig</li>
                            <li>• Du må ikke dele kontoen din med andre</li>
                            <li>• Du må varsle oss umiddelbart ved mistanke om uautorisert tilgang</li>
                            <li>• Vi kan suspendere kontoer som bryter vilkårene</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            4. Canvas-integrasjon
                        </h2>
                        <ul className="space-y-2 text-slate-600 dark:text-slate-400">
                            <li>• Du gir oss tillatelse til å hente data fra Canvas på dine vegne</li>
                            <li>• Vi henter kun data som er nødvendig for tjenestens funksjonalitet</li>
                            <li>• Du kan tilbakekalle tilgangen når som helst via Canvas</li>
                            <li>• Vi er ikke ansvarlige for innhold i Canvas</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            5. AI-assistenten
                        </h2>
                        <ul className="space-y-2 text-slate-600 dark:text-slate-400">
                            <li>• AI-svarene er veiledende og kan inneholde feil</li>
                            <li>• Du bør alltid verifisere viktig informasjon</li>
                            <li>• AI-en skal ikke brukes til juks eller akademisk uredelighet</li>
                            <li>• Vi forbeholder oss retten til å moderere innhold</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            6. Akseptabel bruk
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-3">
                            Du må ikke:
                        </p>
                        <ul className="space-y-2 text-slate-600 dark:text-slate-400">
                            <li>• Bruke tjenesten til ulovlige formål</li>
                            <li>• Forsøke å få uautorisert tilgang til systemer</li>
                            <li>• Overbelaste tjenesten med unødvendige forspørsler</li>
                            <li>• Dele innhold som krenker andres rettigheter</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            7. Ansvarsfraskrivelse
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Tjenesten tilbys &quot;som den er&quot; uten garantier. Vi er ikke ansvarlige for
                            tap eller skade som følge av bruk av tjenesten. Dette inkluderer, men er
                            ikke begrenset til, tap av data, feil i AI-svar, eller nedetid.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            8. Endringer i vilkårene
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Vi kan oppdatere disse vilkårene. Vesentlige endringer vil varsles via
                            e-post eller i appen. Fortsatt bruk etter endringer innebarer aksept
                            av de nye vilkårene.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            9. Kontakt
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Spørsmål om vilkårene kan rettes til oss via{" "}
                            <Link href="/kontakt" className="text-blue-500 hover:underline">
                                kontaktskjemaet
                            </Link>
                            .
                        </p>
                    </section>
                </div>
            </div>
            <Footer />
        </div>
    );
}

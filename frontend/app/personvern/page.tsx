/*
 * Personvern - Personvernerklæring for StudyWise
 */
import Link from "next/link";
import { Footer } from "../components/footer";

export default function PersonvernPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
            <div className="flex-1 max-w-3xl mx-auto px-4 py-12 w-full">
                <Link
                    href="/"
                    className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-8"
                >
                    ← Tilbake til forsiden
                </Link>

                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Personvernerklæring
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
                    Sist oppdatert: Januar 2025
                </p>

                <div className="space-y-6">
                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Hvilke data samler vi inn?
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>Kontoinformasjon:</strong> E-postadresse og passord (kryptert) for innlogging</li>
                            <li><strong>Canvas API-token:</strong> Lagres kryptert for a hente dine Canvas-data</li>
                            <li><strong>Samtalehistorikk:</strong> AI-samtaler lagres kryptert pa din konto</li>
                            <li><strong>Canvas-data:</strong> Vi cacher midlertidig data fra Canvas for bedre ytelse</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Hvordan bruker vi dataene?
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li>For å gi deg tilgang til Canvas-informasjon i appen</li>
                            <li>For å la AI-assistenten svare på spørsmål om dine emner og oppgaver</li>
                            <li>For å lagre samtalehistorikk slik at du kan fortsette tidligere samtaler</li>
                            <li>For å forbedre tjenesten basert på anonymisert bruksdata</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Deling med tredjeparter
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            Vi deler minimalt med tredjeparter:
                        </p>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>AI-tjenester:</strong> Anonymiserte sporsmal sendes til AI-modeller for a generere svar. Personlig informasjon fjernes for sending.</li>
                            <li><strong>Canvas LMS:</strong> Vi bruker ditt API-token for a hente data pa dine vegne</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Dine rettigheter (GDPR)
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>Innsyn:</strong> Du kan se all data vi har lagret om deg</li>
                            <li><strong>Retting:</strong> Du kan oppdatere dine opplysninger</li>
                            <li><strong>Sletting:</strong> Du kan slette kontoen din og all tilknyttet data</li>
                            <li><strong>Dataportabilitet:</strong> Du kan be om eksport av dine data</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Lagring og sikkerhet
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li>Alle sensitive data (passord, API-tokens, samtaler) krypteres med AES-256</li>
                            <li>Data lagres pa sikre servere med tilgangskontroll</li>
                            <li>Vi bruker HTTPS for all kommunikasjon</li>
                            <li>Canvas-data caches midlertidig og slettes automatisk</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Kontakt
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Har du spørsmål om personvern? Kontakt oss via{" "}
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

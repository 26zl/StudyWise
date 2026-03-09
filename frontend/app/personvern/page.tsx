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
                    Sist oppdatert: Mars 2025
                </p>

                <div className="space-y-6">
                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Hvilke data samler vi inn?
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>Kontoinformasjon:</strong> E-postadresse og passord (hashet med bcrypt) for innlogging.</li>
                            <li><strong>Canvas API-token:</strong> Lagres kryptert (AES-256-GCM) for å hente dine Canvas-data på dine vegne.</li>
                            <li><strong>Samtalehistorikk:</strong> AI-samtaler lagres kryptert på din konto. Vi lagrer en kort tittel basert på første spørsmål (f.eks. første 50 tegn) for å vise samtalen i listen.</li>
                            <li><strong>Preferanser og varsler:</strong> Dine valg for Canvas-kontekst og varsler (f.eks. lest/kunngjøringer) lagres knyttet til kontoen din.</li>
                            <li><strong>Canvas-cache:</strong> Vi cacher midlertidig data fra Canvas (emner, oppgaver, kalender) for bedre ytelse. Cache lagres kun kort tid (minutter til timer).</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Formål med behandlingen
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-3">
                            Vi bruker dataene for å:
                        </p>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li>Gi deg tilgang til Canvas-informasjon (emner, oppgaver, kunngjøringer, kalender) i appen.</li>
                            <li>La AI-assistenten svare på spørsmål om dine emner og oppgaver (med anonymisert/redusert kontekst der det er mulig).</li>
                            <li>Lagre samtalehistorikk slik at du kan fortsette tidligere samtaler.</li>
                            <li>Huske dine preferanser og varsler-innstillinger på tvers av enheter.</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Lagringstid
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>Konto og profil:</strong> Inntil du sletter kontoen. Ved kontosletting slettes alle dine data (konto, Canvas-token, samtalehistorikk, preferanser).</li>
                            <li><strong>Samtalehistorikk:</strong> Lagres til du sletter en samtale eller hele historikken, eller til du sletter kontoen.</li>
                            <li><strong>Canvas-cache:</strong> Kortvarig (typisk 5–30 minutter). Cachen slettes eller overskrives automatisk og inneholder ikke persistert personidentifiserbar data utover det som trengs for å vise dine sider.</li>
                            <li><strong>Sesjoner:</strong> Tilgangstoken utløper etter kort tid (f.eks. 30 minutter); oppdateringstoken kan være gyldig lengre (f.eks. 14 dager) inntil du logger ut eller de utløper.</li>
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
                            <li><strong>AI-tjenester (Anthropic):</strong> Innhold du skriver og kontekst (f.eks. oppgavetekst) sendes til AI for å generere svar. Vi unngår å sende personidentifiserbar informasjon (navn, e-post) til AI; Canvas-innhold anonymiseres der det er mulig.</li>
                            <li><strong>Canvas LMS (USN):</strong> Vi bruker kun ditt API-token for å hente data på dine vegne. Tokenet lagres kryptert hos oss og sendes ikke til andre tredjeparter.</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Dine rettigheter (GDPR)
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            Du har rett til innsyn, retting, sletting og dataportabilitet:
                        </p>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li><strong>Innsyn:</strong> Du kan be om oversikt over hvilke data vi har lagret om deg. Kontakt oss via kontaktskjemaet.</li>
                            <li><strong>Retting:</strong> Du kan oppdatere e-post og passord i innstillinger. Canvas-token og preferanser kan du endre eller fjerne under innstillinger.</li>
                            <li><strong>Sletting:</strong> Du kan slette enkelt samtaler eller hele chat-historikken i appen. Du kan slette Canvas-token under innstillinger. For full kontosletting (inkl. konto og all data), kontakt oss via kontaktskjemaet.</li>
                            <li><strong>Dataportabilitet:</strong> Du kan be om eksport av dine data (f.eks. samtalehistorikk). Kontakt oss via kontaktskjemaet.</li>
                        </ul>
                        <p className="text-slate-600 dark:text-slate-400 mt-4">
                            Du kan også klage til Datatilsynet dersom du mener behandlingen bryter personvernlovgivningen.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Lagring og sikkerhet
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li>Sensitive data (Canvas-token, samtalehistorikk) krypteres med AES-256-GCM før lagring.</li>
                            <li>Passord lagres ikke i klartekst; vi bruker bcrypt for hashing.</li>
                            <li>Data lagres på sikre servere med tilgangskontroll. Se også vår <Link href="/sikkerhet" className="text-blue-500 hover:underline">sikkerhetsside</Link>.</li>
                            <li>All kommunikasjon mellom nettleser og servere skjer over HTTPS.</li>
                            <li>Canvas-cache har kort levetid og slettes/roteres automatisk.</li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Kontakt
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Har du spørsmål om personvern eller vil utøve rettighetene dine? Kontakt oss via{" "}
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

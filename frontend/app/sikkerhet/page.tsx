/*
 * Sikkerhet - Sikkerhetsinformasjon for StudyWise
 */
import Link from "next/link";
import { Shield, ShieldCheck, Lock, Eye, Server, Key, RefreshCw, Zap, Cookie } from "lucide-react";
import { Footer } from "../components/footer";

export default function SikkerhetPage() {
    const sikkerhetsTiltak = [
        {
            icon: Lock,
            title: "Kryptering",
            description: "Alle sensitive data krypteres med AES-256-GCM for lagring. Passord hashes med bcrypt og lagres aldri i klartekst.",
        },
        {
            icon: Key,
            title: "Sikker tokenhandtering",
            description: "Canvas API-tokens lagres kryptert og brukes kun server-side. De eksponeres aldri til nettleseren eller tredjeparter.",
        },
        {
            icon: Shield,
            title: "HTTPS og sikkerhetsheadere",
            description: "All kommunikasjon skjer over TLS. Vi bruker Helmet for sikkerhetsheadere (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Content-Security-Policy i produksjon).",
        },
        {
            icon: ShieldCheck,
            title: "CSRF-beskyttelse",
            description: "State-endrende forespørsler (POST, PUT, PATCH, DELETE) krever en gyldig CSRF-header og at forespørselen kommer fra vår egen nettside, for å forhindre tredjepartsider i å utføre handlinger på dine vegne.",
        },
        {
            icon: Zap,
            title: "Rate limiting",
            description: "Vi begrenser antall forespørsler per IP og per tjeneste (innlogging, KI, Canvas, API-token). Det reduserer risiko for misbruk og brute-force-angrep.",
        },
        {
            icon: Cookie,
            title: "Sikre sesjoner (JWT)",
            description: "Innlogging bruker JWT med kort levetid for tilgangstoken og lengre for oppdateringstoken. Cookies er httpOnly, secure og sameSite, så de er ikke tilgjengelige for skript og sendes kun over HTTPS.",
        },
        {
            icon: Eye,
            title: "Minimalt datainnsyn",
            description: "Vi henter kun data fra Canvas som er nødvendig for funksjonaliteten du bruker. Se vår personvernerklæring for hvordan vi behandler data.",
        },
        {
            icon: Server,
            title: "Sikker infrastruktur",
            description: "Applikasjonen kjører på sikre plattformer (Vercel, Render) med brannmur og tilgangskontroll. Cloudflare brukes for DDoS-beskyttelse og SSL/TLS.",
        },
        {
            icon: RefreshCw,
            title: "Automatisk utlogging",
            description: "Sesjoner utløper automatisk. Tilgangstoken har kort levetid (f.eks. 30 minutter); ved inaktivitet må du logge inn på nytt eller bruke oppdateringstoken.",
        },
    ];

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
                    Sikkerhet
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mb-8">
                    Sikkerheten til dine data er vår høyeste prioritet.
                </p>

                <div className="grid gap-4 mb-8">
                    {sikkerhetsTiltak.map((tiltak) => (
                        <div
                            key={tiltak.title}
                            className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex gap-4"
                        >
                            <div className="p-2 h-fit rounded-lg bg-green-100 dark:bg-green-900/30">
                                <tiltak.icon className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    {tiltak.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {tiltak.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 mb-6">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                        Canvas API-sikkerhet
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                        Når du kobler til Canvas, bruker vi ditt personlige API-token:
                    </p>
                    <ul className="space-y-2 text-slate-600 dark:text-slate-400 text-sm">
                        <li>• Tokenet gir kun lesetilgang til dine egne data</li>
                        <li>• Vi kan ikke endre noe i Canvas på dine vegne</li>
                        <li>• Du kan tilbakekalle tokenet i Canvas når som helst</li>
                        <li>• Tokenet lagres kryptert og sendes aldri til tredjeparter</li>
                    </ul>
                </section>

                <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 mb-6">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                        Logging og personvern
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                        På serveren logger vi feil og generell bruk for drift og feilsøking. Vi logger ikke e-post, navn eller andre personidentifiserbare opplysninger i produksjon. Dette bidrar til både sikkerhet og personvern.
                    </p>
                </section>

                <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 mb-6">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                        AI og personvern
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                        Når du bruker AI-assistenten:
                    </p>
                    <ul className="space-y-2 text-slate-600 dark:text-slate-400 text-sm">
                        <li>• Personlig identifiserbar informasjon unngås eller fjernes før sending til AI-tjenesten</li>
                        <li>• Canvas-innhold anonymiseres der det er mulig</li>
                        <li>• Samtaler lagres kryptert på din konto; en kort tittel fra første spørsmål lagres for visning i listen</li>
                        <li>• Du kan slette samtalehistorikken eller enkelt samtaler når som helst</li>
                    </ul>
                    <p className="text-slate-600 dark:text-slate-400 mt-4 text-sm">
                        Mer om behandling av personopplysninger finner du i vår <Link href="/personvern" className="text-blue-500 hover:underline">personvernerklæring</Link>.
                    </p>
                </section>

                <section className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-6 border border-amber-200 dark:border-amber-800">
                    <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
                        Rapporter sikkerhetsproblemer
                    </h2>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        Har du oppdaget en sikkerhetssvakhet? Kontakt oss umiddelbart via{" "}
                        <Link href="/kontakt" className="underline hover:no-underline">
                            kontaktskjemaet
                        </Link>
                        . Vi tar alle rapporter på alvor og vil respondere raskt.
                    </p>
                </section>
            </div>
            <Footer />
        </div>
    );
}

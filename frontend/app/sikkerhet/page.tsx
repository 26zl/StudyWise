/*
 * Sikkerhet - Sikkerhetsinformasjon for StudyWise
 */
import Link from "next/link";
import { Shield, Lock, Eye, Server, Key, RefreshCw } from "lucide-react";
import { Footer } from "../components/footer";

export default function SikkerhetPage() {
    const sikkerhetsTiltak = [
        {
            icon: Lock,
            title: "Kryptering",
            description: "Alle sensitive data krypteres med AES-256-GCM for lagring. Passord hashes med bcrypt.",
        },
        {
            icon: Key,
            title: "Sikker tokenhandtering",
            description: "Canvas API-tokens lagres kryptert og brukes kun server-side. De eksponeres aldri til nettleseren.",
        },
        {
            icon: Shield,
            title: "HTTPS",
            description: "All kommunikasjon mellom din nettleser og vare servere er kryptert med TLS.",
        },
        {
            icon: Eye,
            title: "Minimalt datainnsyn",
            description: "Vi henter kun data fra Canvas som er nødvendig for funksjonaliteten du bruker.",
        },
        {
            icon: Server,
            title: "Sikker infrastruktur",
            description: "Applikasjonen kjører på sikre servere med brannmur og tilgangskontroll.",
        },
        {
            icon: RefreshCw,
            title: "Automatisk utlogging",
            description: "Sesjoner utløper automatisk etter inaktivitet for å beskytte kontoen din.",
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
                        AI og personvern
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-4">
                        Når du bruker AI-assistenten:
                    </p>
                    <ul className="space-y-2 text-slate-600 dark:text-slate-400 text-sm">
                        <li>• Personlig identifiserbar informasjon fjernes for sending til AI</li>
                        <li>• Canvas-innhold anonymiseres der det er mulig</li>
                        <li>• Samtaler lagres kryptert på din konto</li>
                        <li>• Du kan slette samtalehistorikken når som helst</li>
                    </ul>
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
                        . Vi tar alle rapporter pa alvor og vil respondere raskt.
                    </p>
                </section>
            </div>
            <Footer />
        </div>
    );
}

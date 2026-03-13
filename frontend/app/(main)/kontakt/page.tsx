/*
 * Kontakt - Kontaktinformasjon for StudyWise
 */
import Link from "next/link";
import { Mail, MessageSquare, Github, School } from "lucide-react";
import { Footer } from "@/app/components/layout/footer";

export default function KontaktPage() {
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
                    Kontakt oss
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mb-8">
                    Har du spørsmål, tilbakemeldinger eller trenger hjelp? Ta kontakt med oss.
                </p>

                <div className="grid gap-4 mb-8">
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex gap-4">
                        <div className="p-2 h-fit rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                E-post
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                For generelle henvendelser og support
                            </p>
                            <span className="text-sm text-slate-500 dark:text-slate-500 italic">
                                Kommer snart
                            </span>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex gap-4">
                        <div className="p-2 h-fit rounded-lg bg-purple-100 dark:bg-purple-900/30">
                            <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                Tilbakemeldinger
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Vi setter pris på alle tilbakemeldinger som kan hjelpe oss
                                å forbedre StudyWise. Del gjerne dine tanker og forslag.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex gap-4">
                        <div className="p-2 h-fit rounded-lg bg-slate-100 dark:bg-slate-800">
                            <Github className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                Feilrapportering
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Har du funnet en feil? Rapporter den slik at vi kan fikse den.
                                Inkluder gjerne skjermbilder og steg for å reprodusere feilen.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex gap-4">
                        <div className="p-2 h-fit rounded-lg bg-green-100 dark:bg-green-900/30">
                            <School className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                Universitetet i Sør-Øst-Norge
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                StudyWise er et bachelorprosjekt ved USN, Institutt for
                                IT og informasjonssystemer.
                            </p>
                        </div>
                    </div>
                </div>

                <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                        Ofte stilte spørsmål
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <h3 className="font-medium text-slate-900 dark:text-white mb-1">
                                Hvordan får jeg Canvas API-token?
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Logg inn på Canvas, gå til Innstillinger → Godkjente integrasjoner,
                                og klikk &quot;Ny tilgangstoken&quot;. Kopier tokenet og lim det inn i
                                StudyWise under Innstillinger.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-medium text-slate-900 dark:text-white mb-1">
                                Er dataene mine trygge?
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Ja, alle sensitive data krypteres. Les mer på vår{" "}
                                <Link href="/sikkerhet" className="text-blue-500 hover:underline">
                                    sikkerhetsside
                                </Link>
                                .
                            </p>
                        </div>
                        <div>
                            <h3 className="font-medium text-slate-900 dark:text-white mb-1">
                                Hvordan sletter jeg kontoen min?
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Gå til Innstillinger eller kontakt oss for å be om kontosletting.
                                Kontoopplysninger og tilknyttede data slettes eller anonymiseres,
                                mens begrensede sikkerhets- og revisjonslogger kan beholdes i
                                pseudonymisert form i en begrenset periode.
                            </p>
                        </div>
                    </div>
                </section>
            </div>
            <Footer />
        </div>
    );
}

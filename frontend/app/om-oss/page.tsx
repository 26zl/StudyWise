/*
 * Om oss - Informasjon om StudyWise
 */
import Link from "next/link";
import { Footer } from "../components/footer";

export default function OmOssPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
            <div className="flex-1 w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <Link
                    href="/"
                    className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-8"
                >
                    ← Tilbake til forsiden
                </Link>

                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
                    Om StudyWise
                </h1>

                <div className="prose prose-slate dark:prose-invert max-w-none space-y-6">
                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Hva er StudyWise?
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            StudyWise er en AI-drevet studieassistent utviklet som et bachelorprosjekt
                            ved Universitetet i Sør-Øst-Norge (USN). Applikasjonen integrerer med
                            Canvas LMS for å gi studenter en sentralisert plattform for å holde
                            oversikt over studiene sine.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Funksjoner
                        </h2>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex gap-2">
                                <span className="text-blue-500">•</span>
                                <span><strong>Canvas-integrasjon:</strong> Se kunngjøringer, emner, frister og kalender fra Canvas</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-blue-500">•</span>
                                <span><strong>AI-assistent:</strong> Få hjelp med studier, oppgaver og spørsmål om Canvas-innhold</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-blue-500">•</span>
                                <span><strong>Kalender:</strong> Oversikt over alle frister og hendelser på ett sted</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-blue-500">•</span>
                                <span><strong>Samtalehistorikk:</strong> Lagre og fortsett samtaler med AI-en</span>
                            </li>
                        </ul>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Teamet
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            StudyWise er utviklet av studenter ved USN som en del av deres
                            bacheloroppgave i IT og informasjonssystemer. Prosjektet fokuserer på å utforske
                            hvordan AI kan forbedre studieopplevelsen for studenter.
                        </p>
                    </section>

                    <section className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                            Teknologi
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            Applikasjonen er bygget med moderne teknologier:
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {["Next.js", "React", "TypeScript", "Tailwind CSS", "Express", "MongoDB", "Redis"].map((tech) => (
                                <span
                                    key={tech}
                                    className="px-3 py-1 text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full"
                                >
                                    {tech}
                                </span>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
            <Footer />
        </div>
    );
}

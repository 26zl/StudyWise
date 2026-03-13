/*
* Footer-komponent
*/
import Link from "next/link";

export function Footer() {
    return (
        <footer className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="px-4 py-3">
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mb-2">
                    <Link
                        href="/om-oss"
                        prefetch={false}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        Om oss
                    </Link>
                    <Link
                        href="/personvern"
                        prefetch={false}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        Personvern
                    </Link>
                    <Link
                        href="/sikkerhet"
                        prefetch={false}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        Sikkerhet
                    </Link>
                    <Link
                        href="/vilkar"
                        prefetch={false}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        Vilkår
                    </Link>
                    <Link
                        href="/kontakt"
                        prefetch={false}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        Kontakt
                    </Link>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center leading-tight">
                    © 2026 StudyWise - USN Bachelorprosjekt. Alle rettigheter reservert.
                </p>
            </div>
        </footer>
    );
}

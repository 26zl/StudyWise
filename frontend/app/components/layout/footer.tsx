/*
* Footer-komponent
*/
import Link from "next/link";

export function Footer() {
    return (
        <footer className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="px-4 py-3">
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mb-2">
                    <Link
                        href="/om-oss"
                        prefetch={false}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        Om oss
                    </Link>
                    <Link
                        href="/personvern"
                        prefetch={false}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        Personvern
                    </Link>
                    <Link
                        href="/sikkerhet"
                        prefetch={false}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        Sikkerhet
                    </Link>
                    <Link
                        href="/vilkar"
                        prefetch={false}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        Vilkår
                    </Link>
                    <Link
                        href="/kontakt"
                        prefetch={false}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        Kontakt
                    </Link>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 text-center leading-tight">
                    © 2026 StudyWise - USN Bachelorprosjekt. Alle rettigheter reservert.
                </p>
            </div>
        </footer>
    );
}

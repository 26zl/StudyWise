/*
* Footer-komponent
*/
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";

export function Footer() {
    const { language } = useLanguage();
    const labels = language === "en"
        ? {
            about: "About us",
            privacy: "Privacy",
            security: "Security",
            terms: "Terms",
            faq: "FAQ",
            contact: "Contact",
            copyright: "© 2026 StudyWise - USN bachelor project. All rights reserved.",
        }
        : {
            about: "Om oss",
            privacy: "Personvern",
            security: "Sikkerhet",
            terms: "Vilkår",
            faq: "FAQ",
            contact: "Kontakt",
            copyright: "© 2026 StudyWise - USN Bachelorprosjekt. Alle rettigheter reservert.",
        };

    return (
        <footer className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="px-4 py-3">
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mb-2">
                    <Link
                        href="/om-oss"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.about}
                    </Link>
                    <Link
                        href="/personvern"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.privacy}
                    </Link>
                    <Link
                        href="/sikkerhet"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.security}
                    </Link>
                    <Link
                        href="/vilkar"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.terms}
                    </Link>
                    <Link
                        href="/faq"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.faq}
                    </Link>
                    <Link
                        href="/kontakt"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-2 min-h-11 inline-flex items-center justify-center touch-manipulation"
                    >
                        {labels.contact}
                    </Link>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 text-center leading-tight">
                    {labels.copyright}
                </p>
            </div>
        </footer>
    );
}

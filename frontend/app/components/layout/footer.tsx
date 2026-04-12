/*
* Footer-komponent
*/
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";

export function Footer() {
    const { t } = useLanguage();

    return (
        <footer className="shrink-0 border-t border-slate-200 dark:border-transparent bg-white dark:bg-slate-900">
            <div className="px-4 py-2.5">
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-0 mb-0.5">
                    <Link
                        href="/om-oss"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.about")}
                    </Link>
                    <Link
                        href="/personvern"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.privacy")}
                    </Link>
                    <Link
                        href="/sikkerhet"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.security")}
                    </Link>
                    <Link
                        href="/vilkar"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.terms")}
                    </Link>
                    <Link
                        href="/faq"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.faq")}
                    </Link>
                    <Link
                        href="/kontakt"
                        prefetch={false}
                        className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center justify-center touch-manipulation"
                    >
                        {t("footer.contact")}
                    </Link>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center leading-tight">
                    {t("footer.copyright")}
                </p>
            </div>
        </footer>
    );
}

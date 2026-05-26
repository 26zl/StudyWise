/**
 * InfoPageLayout – felles layout for informasjonssider (Om oss, Personvern, Sikkerhet, Vilkår, Kontakt).
 * Gir tittel, valgfri beskrivelse, tilbake-lenke og hjelpekomponenter InfoSection/InfoCard.
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Footer } from "@/app/components/layout/footer";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";

export const INFO_PAGE_INLINE_LINK_CLASSNAME =
  "font-medium text-blue-700 underline underline-offset-2 decoration-current/70 transition-colors hover:text-blue-800 hover:decoration-current dark:text-blue-300 dark:hover:text-blue-200";

type InfoPageLayoutProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  updatedAt?: string;
  /** Versjonsstreng for vilkår/personvern (vises sammen med updatedAt). */
  version?: string;
  backHref?: string;
  backLabel?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

type InfoSectionProps = {
  title?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

type InfoCardProps = {
  className?: string;
  children: ReactNode;
};

export function InfoPageLayout({
  eyebrow,
  title,
  description,
  updatedAt,
  version,
  backHref = "/",
  backLabel,
  className,
  contentClassName,
  children,
}: InfoPageLayoutProps) {
  const { t } = useLanguage();
  const resolvedBackLabel = backLabel ?? t("infoPageLayout.backToHome");
  const cleanBackLabel = resolvedBackLabel.replace(/^[\s\u2190<-]+/, "").trim();
  const updatedAtLabel = t("infoPageLayout.lastUpdated");
  const versionLabel = t("infoPageLayout.version");

  return (
    <div className={cn("min-h-full flex flex-col", className)}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:px-8">
        <Link
          href={backHref}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{cleanBackLabel}</span>
        </Link>

        <header className="mb-8 mt-6 space-y-3 sm:mb-10">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-base leading-7 text-slate-600 sm:text-lg dark:text-slate-300">
              {description}
            </p>
          ) : null}
          {updatedAt ? (
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {updatedAtLabel}: {updatedAt}
              {version ? (
                <>
                  {" "}
                  · {versionLabel} {version}
                </>
              ) : null}
            </p>
          ) : null}
        </header>

        <div className={cn("space-y-4 sm:space-y-5", contentClassName)}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function InfoSection({ title, className, contentClassName, children }: InfoSectionProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-200/90 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.45)] backdrop-blur-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
          {title}
        </h2>
      ) : null}
      <div
        className={cn("text-[15px] leading-7 text-slate-600 dark:text-slate-300", contentClassName)}
      >
        {children}
      </div>
    </section>
  );
}

export function InfoCard({ className, children }: InfoCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/90 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

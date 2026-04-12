/**
 * InfoPageLayout – felles layout for informasjonssider (Om oss, Personvern, Sikkerhet, Vilkår, Kontakt).
 * Gir tittel, valgfri beskrivelse, tilbake-lenke og hjelpekomponenter InfoSection/InfoCard.
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Footer } from "@/app/components/layout/footer";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";

export const INFO_PAGE_INLINE_LINK_CLASSNAME =
  "font-medium text-blue-700 underline underline-offset-2 decoration-current/70 transition-colors hover:text-blue-800 hover:decoration-current dark:text-blue-300 dark:hover:text-blue-200";

type InfoPageLayoutProps = {
  title: string;
  description?: string;
  updatedAt?: string;
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
  title,
  description,
  updatedAt,
  backHref = "/",
  backLabel,
  className,
  contentClassName,
  children,
}: InfoPageLayoutProps) {
  const { t } = useLanguage();
  const resolvedBackLabel = backLabel ?? t("infoPageLayout.backToHome");
  const updatedAtLabel = t("infoPageLayout.lastUpdated");

  return (
    <div className={cn("min-h-full flex flex-col", className)}>
      <div className="mx-auto flex-1 w-full max-w-3xl px-4 py-12 sm:px-6 lg:max-w-5xl lg:px-8 xl:max-w-6xl">
        <Link
          href={backHref}
          prefetch={false}
          className="mb-8 inline-flex items-center text-sm text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          {resolvedBackLabel}
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{title}</h1>
          {description ? (
            <p className="mt-2 text-slate-600 dark:text-slate-400">{description}</p>
          ) : null}
          {updatedAt ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {updatedAtLabel}: {updatedAt}
            </p>
          ) : null}
        </header>

        <div className={cn("space-y-6", contentClassName)}>{children}</div>
      </div>
      <Footer />
    </div>
  );
}

export function InfoSection({
  title,
  className,
  contentClassName,
  children,
}: InfoSectionProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      ) : null}
      <div className={cn("text-slate-600 dark:text-slate-400", contentClassName)}>{children}</div>
    </section>
  );
}

export function InfoCard({ className, children }: InfoCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

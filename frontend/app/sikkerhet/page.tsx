/*
 * Sikkerhet - Sikkerhetsinformasjon for StudyWise
 */
"use client";

import Link from "next/link";
import {
  Code2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import {
  InfoCard,
  InfoPageLayout,
  InfoSection,
  INFO_PAGE_INLINE_LINK_CLASSNAME,
} from "@/app/components/layout/InfoPageLayout";

export default function SikkerhetPage() {
  const { t } = useLanguage();

  return (
    <InfoPageLayout
      title={t("sikkerhet.title")}
      description={t("sikkerhet.description")}
    >
      <div className="grid gap-4">
        {([
          { key: "encryption", color: "green" },
          { key: "token", color: "green" },
          { key: "twoFactor", color: "green" },
          { key: "stepUp", color: "green" },
          { key: "fileValidation", color: "green" },
          { key: "https", color: "green" },
          { key: "csrf", color: "green" },
          { key: "rateLimit", color: "green" },
          { key: "sessions", color: "green" },
          { key: "minimalAccess", color: "green" },
          { key: "infrastructure", color: "green" },
          { key: "autoLogout", color: "green" },
        ] as const).map((item) => (
          <InfoCard key={item.key} className="flex gap-4">
            <div className="h-fit rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
              <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">
                {t(`sikkerhet.${item.key}Title`)}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t(`sikkerhet.${item.key}Body`)}
              </p>
            </div>
          </InfoCard>
        ))}
      </div>

      <InfoSection title={t("sikkerhet.canvasApiTitle")}>
        <p className="mb-4">{t("sikkerhet.canvasApiIntro")}</p>
        <ul className="space-y-2 text-sm">
          <li>• {t("sikkerhet.canvasApi1")}</li>
          <li>• {t("sikkerhet.canvasApi2")}</li>
          <li>• {t("sikkerhet.canvasApi3")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("sikkerhet.loggingTitle")}>
        <p>{t("sikkerhet.loggingBody")}</p>
      </InfoSection>

      <InfoSection title={t("sikkerhet.aiPrivacyTitle")}>
        <p className="mb-4">{t("sikkerhet.aiPrivacyIntro")}</p>
        <ul className="space-y-2 text-sm">
          <li>• {t("sikkerhet.aiPrivacy1")}</li>
          <li>• {t("sikkerhet.aiPrivacy2")}</li>
          <li>• {t("sikkerhet.aiPrivacy3")}</li>
          <li>• {t("sikkerhet.aiPrivacy4")}</li>
        </ul>
        <p className="mt-4 text-sm">
          {t("sikkerhet.aiPrivacyMore")}{" "}
          <Link href="/personvern" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
            {t("sikkerhet.aiPrivacyLink")}
          </Link>
          .
        </p>
      </InfoSection>

      <InfoSection title={t("sikkerhet.sdlcTitle")}>
        <p className="mb-4">{t("sikkerhet.sdlcIntro")}</p>
        <ul className="space-y-2 text-sm">
          <li>• <strong>{t("sikkerhet.sdlcOwaspLabel")}</strong> {t("sikkerhet.sdlcOwaspBody")}</li>
          <li>• <strong>{t("sikkerhet.sdlcCiLabel")}</strong> {t("sikkerhet.sdlcCiBody")}</li>
          <li>• <strong>{t("sikkerhet.sdlcSupplyChainLabel")}</strong> {t("sikkerhet.sdlcSupplyChainBody")}</li>
          <li>• <strong>{t("sikkerhet.sdlcEnvSeparationLabel")}</strong> {t("sikkerhet.sdlcEnvSeparationBody")}</li>
          <li>• <strong>{t("sikkerhet.sdlcReviewLabel")}</strong> {t("sikkerhet.sdlcReviewBody")}</li>
        </ul>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          {t("sikkerhet.sdlcStandardsNote")}
        </p>
      </InfoSection>

      <InfoSection title={t("sikkerhet.openSourceTitle")}>
        <div className="mb-4 flex items-start gap-3">
          <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-600 dark:text-slate-400" />
          <p>{t("sikkerhet.openSourceBody")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/26zl/StudyWise"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Code2 className="h-4 w-4" />
            {t("sikkerhet.openSourceGithub")}
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
          <a
            href="https://www.virustotal.com/gui/domain/studwize.page"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("sikkerhet.openSourceVirusTotal")}
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          {t("sikkerhet.openSourceCI")}
        </p>
      </InfoSection>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
        <h2 className="mb-2 text-lg font-semibold text-amber-800 dark:text-amber-200">
          {t("sikkerhet.reportTitle")}
        </h2>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {t("sikkerhet.reportBody")}{" "}
          <Link href="/kontakt" prefetch={false} className="underline hover:no-underline">
            {t("sikkerhet.reportLink")}
          </Link>
          {t("sikkerhet.reportSuffix")}
        </p>
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          {t("sikkerhet.reportSecurityTxtIntro")}{" "}
          <a
            href="/.well-known/security.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            {t("sikkerhet.reportSecurityTxtLink")}
          </a>{" "}
          {t("sikkerhet.reportSecurityTxtSuffix")}
        </p>
      </section>
    </InfoPageLayout>
  );
}

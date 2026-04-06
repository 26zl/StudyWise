/*
 * Om oss - Informasjon om StudyWise
 */
"use client";

import { useLanguage } from "@/app/i18n";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function OmOssPage() {
  const { t } = useLanguage();

  const features = [
    { label: t("omOss.featureCanvasLabel"), body: t("omOss.featureCanvasBody") },
    { label: t("omOss.featureAILabel"), body: t("omOss.featureAIBody") },
    { label: t("omOss.featureCalendarLabel"), body: t("omOss.featureCalendarBody") },
    { label: t("omOss.featureDocumentsLabel"), body: t("omOss.featureDocumentsBody") },
    { label: t("omOss.featureTaskBreakdownLabel"), body: t("omOss.featureTaskBreakdownBody") },
    { label: t("omOss.featureWorkplanLabel"), body: t("omOss.featureWorkplanBody") },
    { label: t("omOss.featureChatHistoryLabel"), body: t("omOss.featureChatHistoryBody") },
    { label: t("omOss.featureExportLabel"), body: t("omOss.featureExportBody") },
    { label: t("omOss.featureShareLabel"), body: t("omOss.featureShareBody") },
  ];

  return (
    <InfoPageLayout title={t("omOss.title")}>
      <InfoSection title={t("omOss.whatTitle")}>
        <p>{t("omOss.whatBody")}</p>
      </InfoSection>

      <InfoSection title={t("omOss.featuresTitle")}>
        <ul className="space-y-3">
          {features.map(({ label, body }) => (
            <li key={label} className="flex gap-2">
              <span className="text-blue-500 dark:text-blue-400">•</span>
              <span>
                <strong>{label}</strong> {body}
              </span>
            </li>
          ))}
        </ul>
      </InfoSection>

      <InfoSection title={t("omOss.teamTitle")}>
        <p>{t("omOss.teamBody")}</p>
      </InfoSection>

      <InfoSection title={t("omOss.techTitle")}>
        <p className="mb-4">{t("omOss.techBody")}</p>
        <div className="flex flex-wrap gap-2">
          {["Next.js", "React", "TypeScript", "Tailwind CSS", "Express", "MongoDB", "Redis", "Clerk", "Claude (Anthropic)", "Pinecone", "Cohere", "Datadog", "Cloudflare"].map((tech) => (
            <span
              key={tech}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {tech}
            </span>
          ))}
        </div>
      </InfoSection>
    </InfoPageLayout>
  );
}

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
    { label: t("omOss.featureKnowledgeBaseLabel"), body: t("omOss.featureKnowledgeBaseBody") },
    { label: t("omOss.featureQuizFlashcardsLabel"), body: t("omOss.featureQuizFlashcardsBody") },
    { label: t("omOss.featureCalendarLabel"), body: t("omOss.featureCalendarBody") },
    { label: t("omOss.featureDocumentsLabel"), body: t("omOss.featureDocumentsBody") },
    { label: t("omOss.featureTaskBreakdownLabel"), body: t("omOss.featureTaskBreakdownBody") },
    { label: t("omOss.featureWorkplanLabel"), body: t("omOss.featureWorkplanBody") },
    { label: t("omOss.featureChatHistoryLabel"), body: t("omOss.featureChatHistoryBody") },
    { label: t("omOss.featureExportLabel"), body: t("omOss.featureExportBody") },
    { label: t("omOss.featureShareLabel"), body: t("omOss.featureShareBody") },
    { label: t("omOss.featurePushLabel"), body: t("omOss.featurePushBody") },
  ];

  return (
    <InfoPageLayout eyebrow={t("footer.about")} title={t("omOss.title")}>
      <InfoSection title={t("omOss.whatTitle")}>
        <p>{t("omOss.whatBody")}</p>
      </InfoSection>

      <InfoSection title={t("omOss.featuresTitle")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map(({ label, body }) => (
            <li
              key={label}
              className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
            >
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                <strong className="font-semibold text-slate-900 dark:text-white">{label}</strong>{" "}
                {body}
              </p>
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
          {[
            "Next.js",
            "React",
            "TypeScript",
            "Tailwind CSS",
            "Express",
            "MongoDB",
            "Redis",
            "BullMQ",
            "Clerk",
            "Claude (Anthropic)",
            "Pinecone",
            "Cohere",
            "Datadog",
            "PostHog",
            "LangSmith",
            "Resend",
            "Cloudflare",
            "Heroku",
            "Vercel",
          ].map((tech) => (
            <span
              key={tech}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {tech}
            </span>
          ))}
        </div>
      </InfoSection>
    </InfoPageLayout>
  );
}

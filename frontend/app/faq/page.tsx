/*
 * FAQ - Ofte stilte spørsmål om StudyWise
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLanguage } from "@/app/i18n";
import {
  InfoPageLayout,
  InfoSection,
  INFO_PAGE_INLINE_LINK_CLASSNAME,
} from "@/app/components/layout/InfoPageLayout";

export default function FaqPage() {
  const { t } = useLanguage();

  const sporsmal: { kategori: string; items: { q: string; a: ReactNode }[] }[] = [
    {
      kategori: t("faq.categoryCanvas"),
      items: [
        {
          q: t("faq.canvasTokenQ"),
          a: (
            <>
              {t("faq.canvasTokenA")}
            </>
          ),
        },
        {
          q: t("faq.canvasInstitutionsQ"),
          a: t("faq.canvasInstitutionsA"),
        },
      ],
    },
    {
      kategori: t("faq.categorySecurityPrivacy"),
      items: [
        {
          q: t("faq.dataSecureQ"),
          a: (
            <>
              {t("faq.dataSecureA")}{" "}
              <Link href="/sikkerhet" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.dataSecureLink")}
              </Link>
              .
            </>
          ),
        },
        {
          q: t("faq.twoFactorQ"),
          a: t("faq.twoFactorA"),
        },
        {
          q: t("faq.thirdPartyQ"),
          a: (
            <>
              {t("faq.thirdPartyA1")}{" "}
              <Link href="/personvern" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.thirdPartyLink")}
              </Link>{" "}
              {t("faq.thirdPartyA2")}
            </>
          ),
        },
      ],
    },
    {
      kategori: t("faq.categoryAccount"),
      items: [
        {
          q: t("faq.deleteAccountQ"),
          a: (
            <>
              {t("faq.deleteAccountA1")}{" "}
              <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.deleteAccountLink")}
              </Link>{" "}
              {t("faq.deleteAccountA2")}
            </>
          ),
        },
        {
          q: t("faq.withoutCanvasQ"),
          a: t("faq.withoutCanvasA"),
        },
      ],
    },
    {
      kategori: t("faq.categoryFeatures"),
      items: [
        {
          q: t("faq.fileTypesQ"),
          a: t("faq.fileTypesA"),
        },
        {
          q: t("faq.knowledgeBaseQ"),
          a: t("faq.knowledgeBaseA"),
        },
        {
          q: t("faq.quizQ"),
          a: t("faq.quizA"),
        },
        {
          q: t("faq.studyPlanQ"),
          a: t("faq.studyPlanA"),
        },
        {
          q: t("faq.sharedChatsQ"),
          a: t("faq.sharedChatsA"),
        },
      ],
    },
  ];

  return (
    <InfoPageLayout
      title={t("faq.title")}
      description={t("faq.description")}
    >
      {sporsmal.map((gruppe) => (
        <InfoSection key={gruppe.kategori} title={gruppe.kategori}>
          <div className="space-y-5">
            {gruppe.items.map((item) => (
              <div key={item.q}>
                <h3 className="mb-1 font-medium text-slate-900 dark:text-white">{item.q}</h3>
                <p className="text-sm leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </InfoSection>
      ))}

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        {t("faq.notFound")}{" "}
        <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
          {t("faq.contactUs")}
        </Link>
        .
      </p>
    </InfoPageLayout>
  );
}

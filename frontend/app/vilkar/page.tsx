/*
 * Vilkår - Brukervilkår for StudyWise
 */
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function VilkarPage() {
  const { t } = useLanguage();

  return (
    <InfoPageLayout title={t("vilkar.title")} updatedAt={t("vilkar.updatedAt")}>
      <InfoSection title={t("vilkar.acceptTitle")}>
        <p>{t("vilkar.acceptBody")}</p>
      </InfoSection>

      <InfoSection title={t("vilkar.serviceTitle")}>
        <p>{t("vilkar.serviceBody")}</p>
      </InfoSection>

      <InfoSection title={t("vilkar.accountTitle")}>
        <ul className="space-y-2">
          <li>• {t("vilkar.account1")}</li>
          <li>• {t("vilkar.account2")}</li>
          <li>• {t("vilkar.account3")}</li>
          <li>• {t("vilkar.account4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.canvasTitle")}>
        <ul className="space-y-2">
          <li>• {t("vilkar.canvas1")}</li>
          <li>• {t("vilkar.canvas2")}</li>
          <li>• {t("vilkar.canvas3")}</li>
          <li>• {t("vilkar.canvas4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.aiTitle")}>
        <ul className="space-y-2">
          <li>• {t("vilkar.ai1")}</li>
          <li>• {t("vilkar.ai2")}</li>
          <li>• {t("vilkar.ai3")}</li>
          <li>• {t("vilkar.ai4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.sharingTitle")}>
        <ul className="space-y-2">
          <li>• {t("vilkar.sharing1")}</li>
          <li>• {t("vilkar.sharing2")}</li>
          <li>• {t("vilkar.sharing3")}</li>
          <li>• {t("vilkar.sharing4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.kbTitle")}>
        <ul className="space-y-2">
          <li>• {t("vilkar.kb1")}</li>
          <li>• {t("vilkar.kb2")}</li>
          <li>• {t("vilkar.kb3")}</li>
          <li>• {t("vilkar.kb4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.useTitle")}>
        <p className="mb-3">{t("vilkar.useIntro")}</p>
        <ul className="space-y-2">
          <li>• {t("vilkar.use1")}</li>
          <li>• {t("vilkar.use2")}</li>
          <li>• {t("vilkar.use3")}</li>
          <li>• {t("vilkar.use4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("vilkar.disclaimerTitle")}>
        <p>{t("vilkar.disclaimerBody")}</p>
      </InfoSection>

      <InfoSection title={t("vilkar.changesTitle")}>
        <p>{t("vilkar.changesBody")}</p>
      </InfoSection>

      <InfoSection title={t("vilkar.contactTitle")}>
        <p>
          {t("vilkar.contactBody")}{" "}
          <Link href="/kontakt" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
            {t("vilkar.contactLink")}
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}

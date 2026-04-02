/*
 * Personvern - Personvernerklæring for StudyWise
 */
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";
import { InfoPageLayout, InfoSection } from "@/app/components/layout/InfoPageLayout";

export default function PersonvernPage() {
  const { t } = useLanguage();

  return (
    <InfoPageLayout title={t("personvern.title")} updatedAt={t("personvern.updatedAt")}>
      <InfoSection title={t("personvern.dataCollectionTitle")}>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.accountInfoLabel")}</strong> {t("personvern.accountInfoBody")}
          </li>
          <li>
            <strong>{t("personvern.cookiesLabel")}</strong> {t("personvern.cookiesBody")}
          </li>
          <li>
            <strong>{t("personvern.canvasTokenLabel")}</strong> {t("personvern.canvasTokenBody")}
          </li>
          <li>
            <strong>{t("personvern.chatHistoryLabel")}</strong> {t("personvern.chatHistoryBody")}
          </li>
          <li>
            <strong>{t("personvern.preferencesLabel")}</strong> {t("personvern.preferencesBody")}
          </li>
          <li>
            <strong>{t("personvern.canvasCacheLabel")}</strong> {t("personvern.canvasCacheBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.legalBasisTitle")}>
        <p className="mb-3">{t("personvern.legalBasisIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.legalBasisContractLabel")}</strong> {t("personvern.legalBasisContractBody")}
          </li>
          <li>
            <strong>{t("personvern.legalBasisInterestLabel")}</strong> {t("personvern.legalBasisInterestBody")}
          </li>
          <li>
            <strong>{t("personvern.legalBasisConsentLabel")}</strong> {t("personvern.legalBasisConsentBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.purposeTitle")}>
        <p className="mb-3">{t("personvern.purposeIntro")}</p>
        <ul className="space-y-3">
          <li>{t("personvern.purpose1")}</li>
          <li>{t("personvern.purpose2")}</li>
          <li>{t("personvern.purpose3")}</li>
          <li>{t("personvern.purpose4")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.retentionTitle")}>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.retentionAccountLabel")}</strong> {t("personvern.retentionAccountBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionChatLabel")}</strong> {t("personvern.retentionChatBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionCacheLabel")}</strong> {t("personvern.retentionCacheBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionSessionLabel")}</strong> {t("personvern.retentionSessionBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.cookiesSectionTitle")}>
        <p>
          {t("personvern.cookiesSectionBody")}
        </p>
      </InfoSection>

      <InfoSection title={t("personvern.thirdPartyTitle")}>
        <p className="mb-4">{t("personvern.thirdPartyIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.thirdPartyAILabel")}</strong> {t("personvern.thirdPartyAIBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyCanvasLabel")}</strong> {t("personvern.thirdPartyCanvasBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyPineconeLabel")}</strong> {t("personvern.thirdPartyPineconeBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyCohereLabel")}</strong> {t("personvern.thirdPartyCohereBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyDatadogLabel")}</strong> {t("personvern.thirdPartyDatadogBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.rightsTitle")}>
        <p className="mb-4">{t("personvern.rightsIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.rightsAccessLabel")}</strong> {t("personvern.rightsAccessBody")}
          </li>
          <li>
            <strong>{t("personvern.rightsCorrectionLabel")}</strong> {t("personvern.rightsCorrectionBody")}
          </li>
          <li>
            <strong>{t("personvern.rightsDeletionLabel")}</strong> {t("personvern.rightsDeletionBody")}
          </li>
          <li>
            <strong>{t("personvern.rightsPortabilityLabel")}</strong> {t("personvern.rightsPortabilityBody")}
          </li>
        </ul>
        <p className="mt-4">{t("personvern.rightsComplaint")}</p>
      </InfoSection>

      <InfoSection title={t("personvern.storageTitle")}>
        <ul className="space-y-3">
          <li>{t("personvern.storageCrypto")}</li>
          <li>{t("personvern.storageClerk")}</li>
          <li>{t("personvern.storageAudit")}</li>
          <li>
            {t("personvern.storageServers")}{" "}
            <Link href="/sikkerhet" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
              {t("personvern.storageServersLink")}
            </Link>
            .
          </li>
          <li>{t("personvern.storageHTTPS")}</li>
          <li>{t("personvern.storageCache")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.contactTitle")}>
        <p>
          {t("personvern.contactBody")}{" "}
          <Link href="/kontakt" prefetch={false} className="text-blue-500 dark:text-blue-400 hover:underline">
            {t("personvern.contactLink")}
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}

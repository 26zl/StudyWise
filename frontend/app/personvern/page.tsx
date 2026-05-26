/*
 * Personvern - Personvernerklæring for StudyWise
 */
"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n";
import {
  InfoPageLayout,
  InfoSection,
  INFO_PAGE_INLINE_LINK_CLASSNAME,
} from "@/app/components/layout/InfoPageLayout";
import { TERMS_VERSION } from "common/system";

export default function PersonvernPage() {
  const { t } = useLanguage();

  return (
    <InfoPageLayout
      eyebrow={t("settings.consent.title")}
      title={t("personvern.title")}
      updatedAt={t("personvern.updatedAt")}
      version={TERMS_VERSION}
    >
      <InfoSection title={t("personvern.controllerTitle")}>
        <p>{t("personvern.controllerBody")}</p>
      </InfoSection>

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
          <li>
            <strong>{t("personvern.feedbackLabel")}</strong> {t("personvern.feedbackBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.legalBasisTitle")}>
        <p className="mb-3">{t("personvern.legalBasisIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.legalBasisContractLabel")}</strong>{" "}
            {t("personvern.legalBasisContractBody")}
          </li>
          <li>
            <strong>{t("personvern.legalBasisInterestLabel")}</strong>{" "}
            {t("personvern.legalBasisInterestBody")}
          </li>
          <li>
            <strong>{t("personvern.legalBasisConsentLabel")}</strong>{" "}
            {t("personvern.legalBasisConsentBody")}
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
            <strong>{t("personvern.retentionAccountLabel")}</strong>{" "}
            {t("personvern.retentionAccountBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionAuditLabel")}</strong>{" "}
            {t("personvern.retentionAuditBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionChatLabel")}</strong>{" "}
            {t("personvern.retentionChatBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionCacheLabel")}</strong>{" "}
            {t("personvern.retentionCacheBody")}
          </li>
          <li>
            <strong>{t("personvern.retentionSessionLabel")}</strong>{" "}
            {t("personvern.retentionSessionBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.cookiesSectionTitle")}>
        <p>{t("personvern.cookiesSectionBody")}</p>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          {t("personvern.cookiesSectionAdblockNote")}
        </p>
      </InfoSection>

      <InfoSection title={t("personvern.thirdPartyTitle")}>
        <p className="mb-4">{t("personvern.thirdPartyIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.thirdPartyHostingLabel")}</strong>{" "}
            {t("personvern.thirdPartyHostingBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyDatabaseLabel")}</strong>{" "}
            {t("personvern.thirdPartyDatabaseBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyClerkLabel")}</strong>{" "}
            {t("personvern.thirdPartyClerkBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyAILabel")}</strong> {t("personvern.thirdPartyAIBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyCanvasLabel")}</strong>{" "}
            {t("personvern.thirdPartyCanvasBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyPineconeLabel")}</strong>{" "}
            {t("personvern.thirdPartyPineconeBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyCohereLabel")}</strong>{" "}
            {t("personvern.thirdPartyCohereBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyDatadogLabel")}</strong>{" "}
            {t("personvern.thirdPartyDatadogBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyPosthogLabel")}</strong>{" "}
            {t("personvern.thirdPartyPosthogBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyLangsmithLabel")}</strong>{" "}
            {t("personvern.thirdPartyLangsmithBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyContactRelayLabel")}</strong>{" "}
            {t("personvern.thirdPartyContactRelayBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyNotionLabel")}</strong>{" "}
            {t("personvern.thirdPartyNotionBody")}
          </li>
          <li>
            <strong>{t("personvern.thirdPartyMapsLabel")}</strong>{" "}
            {t("personvern.thirdPartyMapsBody")}
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
            <strong>{t("personvern.rightsCorrectionLabel")}</strong>{" "}
            {t("personvern.rightsCorrectionBody")}
          </li>
          <li>
            <strong>{t("personvern.rightsDeletionLabel")}</strong>{" "}
            {t("personvern.rightsDeletionBody")}
          </li>
          <li>
            <strong>{t("personvern.rightsPortabilityLabel")}</strong>{" "}
            {t("personvern.rightsPortabilityBody")}
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
            <Link href="/sikkerhet" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
              {t("personvern.storageServersLink")}
            </Link>
            .
          </li>
          <li>{t("personvern.storageHTTPS")}</li>
          <li>{t("personvern.storageCache")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.transferTitle")}>
        <p className="mb-3">{t("personvern.transferIntro")}</p>
        <ul className="space-y-3">
          <li>
            <strong>{t("personvern.transferUSLabel")}</strong> {t("personvern.transferUSBody")}
          </li>
          <li>
            <strong>{t("personvern.transferSafeguardsLabel")}</strong>{" "}
            {t("personvern.transferSafeguardsBody")}
          </li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.automatedTitle")}>
        <p className="mb-3">{t("personvern.automatedBody")}</p>
        <ul className="space-y-2">
          <li>• {t("personvern.automated1")}</li>
          <li>• {t("personvern.automated2")}</li>
          <li>• {t("personvern.automated3")}</li>
        </ul>
      </InfoSection>

      <InfoSection title={t("personvern.ageTitle")}>
        <p>{t("personvern.ageBody")}</p>
      </InfoSection>

      <InfoSection title={t("personvern.breachTitle")}>
        <p>{t("personvern.breachBody")}</p>
      </InfoSection>

      <InfoSection title={t("personvern.contactTitle")}>
        <p>
          {t("personvern.contactBody")}{" "}
          <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
            {t("personvern.contactLink")}
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}

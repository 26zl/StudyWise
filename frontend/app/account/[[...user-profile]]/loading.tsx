/*
 * Profil loading UI – vises ved navigering til /profil mens siden lastes.
 */
"use client";

import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";

export default function ProfilLoading() {
  const { t } = useLanguage();
  return <LoadingView text={t("profil.loading")} />;
}

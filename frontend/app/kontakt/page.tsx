/*
 * Kontakt - Kontaktinformasjon og kontaktskjema for StudyWise
 */
"use client";

import { Code2, Mail, MessageSquare, School, MapPin } from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { InfoCard, InfoPageLayout } from "@/app/components/layout/InfoPageLayout";
import { ContactForm } from "./ContactForm";

export default function KontaktPage() {
  const { t } = useLanguage();

  const kontaktpunkter = [
    {
      icon: MessageSquare,
      title: t("kontakt.feedbackTitle"),
      description: t("kontakt.feedbackBody"),
      accent: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    },
    {
      icon: Code2,
      title: t("kontakt.bugReportTitle"),
      description: t("kontakt.bugReportBody"),
      accent: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    },
    {
      icon: School,
      title: t("kontakt.universityTitle"),
      description: t("kontakt.universityBody"),
      accent: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    },
  ];

  return (
    <InfoPageLayout title={t("kontakt.title")} description={t("kontakt.description")}>
      {/* Kontaktskjema */}
      <InfoCard className="mb-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">
              {t("kontakt.sendMessage")}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("kontakt.email")}</p>
          </div>
        </div>
        <ContactForm />
      </InfoCard>

      {/* Andre kontaktpunkter */}
      <div className="grid gap-4">
        {kontaktpunkter.map((kontaktpunkt) => (
          <InfoCard key={kontaktpunkt.title} className="flex gap-4">
            <div className={`h-fit rounded-lg p-2 ${kontaktpunkt.accent}`}>
              <kontaktpunkt.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">
                {kontaktpunkt.title}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {kontaktpunkt.description}
              </p>
            </div>
          </InfoCard>
        ))}
      </div>

      {/* Kart over campus */}
      <InfoCard className="mt-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">
              {t("kontakt.mapTitle")}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("kontakt.mapLocation")}</p>
          </div>
        </div>
        <div className="h-64 sm:h-80 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800/50">
          <iframe
            src="https://www.google.com/maps?q=Universitetet+i+S%C3%B8r%C3%B8st-Norge,+Campus+B%C3%B8&t=&z=15&ie=UTF8&iwloc=&output=embed"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen={false}
            loading="lazy"
            referrerPolicy="no-referrer"
            title={t("kontakt.mapIframeTitle")}
          ></iframe>
        </div>
      </InfoCard>
    </InfoPageLayout>
  );
}

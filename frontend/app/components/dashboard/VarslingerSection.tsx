/*
 * VarslingerSection - Varslingside for dashboardet
 * Deler data og lest/ulest med popup-toast via useVarsler og uiStore.
 */
"use client";

import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import {
    Bell,
    Clock,
    Megaphone,
    CalendarDays,
    MapPin,
    CheckCircle2,
    CheckCheck,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { LoadingView } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import { showToast } from "@/app/components/ui/Toaster";
import { useVarslingerSide, type VarslingTab } from "@/app/hooks/useVarsler";
import { formaterTid, lagVarslingForhandsvisning, type FristStatus } from "@/app/lib/varsler";
import type {
    FristElement,
    OppgaveElement,
    KunngjoringElement,
    HendelseElement,
    VarslingElement,
} from "@/app/lib/varsler";
import { CanvasKIHandlinger } from "@/app/components/ki/CanvasKIActions";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { useUIStore } from "@/app/store/uiStore";
import { useManuellInnlevering } from "@/app/hooks/useManuellInnlevering";
import { useLanguage } from "@/app/i18n";
import { enUS, nb } from "date-fns/locale";

interface VarslingerSectionProps {
    harCanvasToken?: boolean;
}

const NOTIFICATIONS_PAGE_SIZE = 12;
// Varslinger-seksjonen håndterer visning av frister, kunngjøringer og hendelser, med faner for filtrering.
function fristFarge(status: FristStatus) {
    if (status === "kritisk") return "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20";
    if (status === "snart") return "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20";
    return "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50";
}
// Fargevalg for frist-kort basert på klassifisering (kritisk/snart/normal).
function fristBadgeFarge(status: FristStatus) {
    if (status === "kritisk") return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
    if (status === "snart") return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300";
    return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
}
// VarslingerSection - hovedkomponent for varslinger-siden, med faner og kortvisning. Deler data og lest/ulest-status med popup via useVarsler og uiStore.
export function VarslingerSection({ harCanvasToken = false }: VarslingerSectionProps) {
    const [aktivTab, settAktivTab] = useState<VarslingTab>("alle");
    const [offset, setOffset] = useState(0);
    const canvasTokenInvalid = useUIStore((state) => state.canvasTokenInvalid);
    const { language, t } = useLanguage();

    const {
        frister,
        oppgaver,
        kunngjøringer,
        hendelser,
        alleElementer,
        ulesteCount,
        lestIds,
        markAllAsLest,
        isLoading,
        isError,
        hasPartialError,
        error,
    } = useVarslingerSide(harCanvasToken);
    const safeAlle = alleElementer ?? [];

    const tabs: { id: VarslingTab; label: string; antall: number; uleste: number }[] = [
        { id: "alle", label: t("notifications.tabs.all"), antall: safeAlle.length, uleste: safeAlle.filter((e) => !lestIds.has(e.id)).length },
        { id: "frister", label: t("notifications.tabs.deadlines"), antall: frister.length, uleste: frister.filter((e) => !lestIds.has(e.id)).length },
        { id: "oppgaver", label: t("notifications.tabs.assignments"), antall: oppgaver.length, uleste: oppgaver.filter((e) => !lestIds.has(e.id)).length },
        { id: "kunngjøringer", label: t("notifications.tabs.announcements"), antall: kunngjøringer.length, uleste: kunngjøringer.filter((e) => !lestIds.has(e.id)).length },
        { id: "hendelser", label: t("notifications.tabs.events"), antall: hendelser.length, uleste: hendelser.filter((e) => !lestIds.has(e.id)).length },
    ];

    const aktiveListe =
        aktivTab === "alle" ? safeAlle
            : aktivTab === "frister" ? frister
            : aktivTab === "oppgaver" ? oppgaver
            : aktivTab === "kunngjøringer" ? kunngjøringer
            : hendelser;
    const synligeElementer = useMemo(() => {
        return aktiveListe.slice(offset, offset + NOTIFICATIONS_PAGE_SIZE);
    }, [aktiveListe, offset]);
    const totalElementer = aktiveListe.length;
    const harForrigeSide = offset > 0;
    const harNesteSide = offset + NOTIFICATIONS_PAGE_SIZE < totalElementer;
    const fraElement = totalElementer === 0 ? 0 : offset + 1;
    const tilElement = Math.min(offset + NOTIFICATIONS_PAGE_SIZE, totalElementer);

    useEffect(() => {
        setOffset(0);
    }, [aktivTab]);

    useEffect(() => {
        if (totalElementer === 0) {
            if (offset !== 0) setOffset(0);
            return;
        }
        if (offset >= totalElementer) {
            const sisteSideOffset =
                Math.floor((totalElementer - 1) / NOTIFICATIONS_PAGE_SIZE) *
                NOTIFICATIONS_PAGE_SIZE;
            setOffset(sisteSideOffset);
        }
    }, [offset, totalElementer]);

    if (!harCanvasToken) {
        return (
            <div className="p-6 sm:p-8">
                <CanvasTokenNotice />
            </div>
        );
    }
    if (canvasTokenInvalid) {
        return (
            <div className="p-6 sm:p-8">
                <CanvasTokenNotice variant="invalid" />
            </div>
        );
    }

        return (
                <div className="min-h-full">
                    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <Bell className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                <div>
                    <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white">
                        {t("notifications.title")}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {t("notifications.feedDescription")}
                    </p>
                </div>
              </div>
            </div>
          </div>

                    <div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">

              {!isError && safeAlle.length > 0 && ulesteCount > 0 && (
                  <div>
                      <button
                          type="button"
                          onClick={() => {
                              markAllAsLest();
                              showToast.success(t("notifications.allMarkedAsRead"));
                          }}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                      >
                          <CheckCheck className="w-4 h-4 shrink-0" />
                          {t("notifications.markAllAsRead")}
                      </button>
                  </div>
              )}

              {hasPartialError && (
                  <FeilMelding
                      type="warning"
                      melding={lagBrukervennligFeilmelding(
                          error instanceof Error ? error : null,
                          { canvas: true },
                          t("notifications.partialLoadFallback"),
                          t,
                      )}
                  />
              )}

              {!isError && (
                  <div role="tablist" aria-label={t("notifications.title")} className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                      {tabs.map((tab) => (
                          <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={aktivTab === tab.id}
                              aria-controls={`varslinger-tabpanel-${tab.id}`}
                              id={`varslinger-tab-${tab.id}`}
                              onClick={() => settAktivTab(tab.id)}
                              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                  aktivTab === tab.id
                                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                              }`}
                          >
                              {tab.label}
                              <span className={`inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full text-xs font-semibold ${
                                  aktivTab === tab.id
                                      ? "bg-white/90 text-blue-700 dark:bg-slate-900/80 dark:text-blue-200"
                                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                              }`}>
                                  {tab.antall}
                              </span>
                              {tab.uleste > 0 && (
                                  <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold ${
                                      aktivTab === tab.id
                                          ? "bg-blue-600 dark:bg-blue-500 text-white"
                                          : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                  }`}>
                                      {tab.uleste}
                                  </span>
                              )}
                          </button>
                      ))}
                  </div>
              )}

              <div role="tabpanel" id={`varslinger-tabpanel-${aktivTab}`} aria-labelledby={`varslinger-tab-${aktivTab}`}>
              {isLoading ? (
                  <LoadingView translationKey="common.loading.notifications" fullPage={false} />
              ) : isError ? (
                  <FeilMelding
                      melding={lagBrukervennligFeilmelding(
                          error instanceof Error ? error : null,
                          { canvas: true },
                          t("errors.generic.retry"),
                          t,
                      )}
                  />
              ) : aktiveListe.length === 0 ? (
                  <div className="text-center py-12">
                      <Bell className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                          {aktivTab === "alle"
                              ? t("notifications.empty.all")
                              : aktivTab === "frister"
                                  ? t("notifications.empty.deadlines")
                                  : aktivTab === "oppgaver"
                                      ? t("notifications.empty.assignments")
                                  : aktivTab === "kunngjøringer"
                                      ? t("notifications.empty.announcements")
                                      : t("notifications.empty.events")}
                      </p>
                  </div>
              ) : (
                  <div className="space-y-3">
                      {synligeElementer.map((element) => (
                          <VarslingKort key={element.id} element={element} language={language} />
                      ))}
                      {totalElementer > NOTIFICATIONS_PAGE_SIZE && (
                          <div className="flex items-center justify-between pt-2 text-sm text-slate-500 dark:text-slate-400">
                              <span>
                                  {fraElement}–{tilElement} / {totalElementer}
                              </span>
                              <div className="flex gap-2">
                                  <button
                                      type="button"
                                      onClick={() =>
                                          setOffset((current) =>
                                              Math.max(
                                                  0,
                                                  current - NOTIFICATIONS_PAGE_SIZE,
                                              ),
                                          )
                                      }
                                      disabled={!harForrigeSide}
                                      aria-label={language === "en" ? "Previous page" : "Forrige side"}
                                      className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                                  >
                                      <ChevronLeft size={16} />
                                  </button>
                                  <button
                                      type="button"
                                      onClick={() =>
                                          setOffset((current) =>
                                              Math.min(
                                                  current + NOTIFICATIONS_PAGE_SIZE,
                                                  Math.max(
                                                      0,
                                                      totalElementer - NOTIFICATIONS_PAGE_SIZE,
                                                  ),
                                              ),
                                          )
                                      }
                                      disabled={!harNesteSide}
                                      aria-label={language === "en" ? "Next page" : "Neste side"}
                                      className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                                  >
                                      <ChevronRight size={16} />
                                  </button>
                              </div>
                          </div>
                      )}
                  </div>
              )}
              </div>
            </div>
          </div>
        </div>
    );
}

function VarslingKort({ element, language }: { element: VarslingElement; language: "nb" | "en" }) {
    if (element.type === "frist" || element.type === "oppgave") {
        return <OppgaveKort oppgave={element} language={language} />;
    }
    if (element.type === "kunngjoring") return <KunngjoringKort kunngjoring={element} language={language} />;
    return <HendelseKort hendelse={element} language={language} />;
}

function OppgaveKort({
    oppgave,
    language,
}: {
    oppgave: FristElement | OppgaveElement;
    language: "nb" | "en";
}) {
    const { t } = useLanguage();
    const { ferdigeIdSet } = useManuellInnlevering();
    const tidTekst = formaterTid(oppgave.timerIgjen, language);
    const datoLocale = language === "en" ? enUS : nb;
    const assignmentId = "assignmentId" in oppgave
        ? oppgave.assignmentId
        : (() => {
            const match = oppgave.id.match(/(?:oppgave-|frist-)?(\d+)$/);
            return match ? Number(match[1]) : null;
        })();
    const erManueltFerdig = assignmentId !== null && ferdigeIdSet.has(assignmentId);
    const fristTekst = [
        oppgave.tittel,
        `${language === "en" ? "Course" : "Emne"}: ${oppgave.emne}`,
        `${language === "en" ? "Deadline" : "Frist"}: ${format(
            oppgave.dato,
            language === "en" ? "MMMM d, yyyy 'at' HH:mm" : "d. MMMM yyyy 'kl.' HH:mm",
            { locale: datoLocale },
        )}`,
        t("notifications.remaining", { time: tidTekst }),
        oppgave.erInnlevert ? t("notifications.submitted") : "",
    ].filter(Boolean).join(". ");

    return (
        <div className={`p-4 rounded-lg border ${fristFarge(oppgave.status)} transition-colors`}>
            <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className={`font-medium truncate text-base ${erManueltFerdig ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
                                {oppgave.tittel}
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span>{oppgave.emne}</span>
                                {oppgave.erInnlevert && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
                                        <CheckCircle2 className="w-3 h-3" />
                                        {t("notifications.submitted")}
                                    </span>
                                )}
                                {erManueltFerdig && !oppgave.erInnlevert && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                        <CheckCircle2 className="w-3 h-3" />
                                        {t("notifications.manuallySubmitted")}
                                    </span>
                                )}
                            </p>
                        </div>
                        <span className={`shrink-0 px-2 py-1 rounded-md text-xs font-semibold ${fristBadgeFarge(oppgave.status)}`}>
                            <span className="sr-only">
                                {oppgave.status === "kritisk"
                                    ? (language === "en" ? "Urgent" : "Haster")
                                    : oppgave.status === "snart"
                                      ? (language === "en" ? "Soon" : "Snart")
                                      : (language === "en" ? "Upcoming" : "Kommende")}
                                {": "}
                            </span>
                            {t("notifications.remaining", { time: tidTekst })}
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("notifications.deadlineAt", {
                            date: format(oppgave.dato, language === "en" ? "MMMM d, yyyy 'at' HH:mm" : "d. MMMM yyyy 'kl.' HH:mm", { locale: datoLocale }),
                        })}
                    </p>
                    <CanvasKIHandlinger
                        tekst={fristTekst}
                        storrelse="sm"
                        kildetype="assignment"
                        tittel={oppgave.tittel}
                        emne={oppgave.emne}
                    />
                </div>
            </div>
        </div>
    );
}

function KunngjoringKort({ kunngjoring, language }: { kunngjoring: KunngjoringElement; language: "nb" | "en" }) {
    const datoLocale = language === "en" ? enUS : nb;
    const preview = lagVarslingForhandsvisning(kunngjoring.melding);
    const kunngjoringsTekst = [
        kunngjoring.tittel,
        `${language === "en" ? "Course" : "Emne"}: ${kunngjoring.emne}`,
        preview,
    ].filter(Boolean).join(". ");

    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
                <Megaphone className="w-5 h-5 mt-0.5 shrink-0 text-purple-500 dark:text-purple-400" />
                <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-base text-slate-900 dark:text-white">
                        {kunngjoring.tittel}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {kunngjoring.emne} &middot; {formatDistanceToNow(kunngjoring.dato, { addSuffix: true, locale: datoLocale })}
                    </p>
                    {preview && (
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {preview}
                        </p>
                    )}
                    <CanvasKIHandlinger
                        tekst={kunngjoringsTekst}
                        storrelse="sm"
                        kildetype="announcement"
                        tittel={kunngjoring.tittel}
                        emne={kunngjoring.emne}
                    />
                </div>
            </div>
        </div>
    );
}

function HendelseKort({ hendelse, language }: { hendelse: HendelseElement; language: "nb" | "en" }) {
    const datoLocale = language === "en" ? enUS : nb;
    const hendelseTekst = [
        hendelse.tittel,
        `${language === "en" ? "Starts" : "Start"}: ${format(
            hendelse.dato,
            language === "en" ? "MMMM d, yyyy 'at' HH:mm" : "d. MMMM yyyy 'kl.' HH:mm",
            { locale: datoLocale },
        )}`,
        hendelse.sluttDato
            ? `${language === "en" ? "Ends" : "Slutter"}: ${format(hendelse.sluttDato, "HH:mm")}`
            : "",
        hendelse.lokasjon
            ? `${language === "en" ? "Location" : "Lokasjon"}: ${hendelse.lokasjon}`
            : "",
    ].filter(Boolean).join(". ");

    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
                <CalendarDays className="w-5 h-5 mt-0.5 shrink-0 text-blue-500 dark:text-blue-400" />
                <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-base text-slate-900 dark:text-white">
                        {hendelse.tittel}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {hendelse.emne && (
                            <span>{hendelse.emne}</span>
                        )}
                        <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {format(hendelse.dato, language === "en" ? "MMM d HH:mm" : "d. MMM HH:mm", { locale: datoLocale })}
                            {hendelse.sluttDato && ` – ${format(hendelse.sluttDato, "HH:mm")}`}
                        </span>
                        {hendelse.lokasjon && (
                            <span className="flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {hendelse.lokasjon}
                            </span>
                        )}
                    </div>
                    <CanvasKIHandlinger
                        tekst={hendelseTekst}
                        storrelse="sm"
                        kildetype="event"
                        tittel={hendelse.tittel}
                    />
                </div>
            </div>
        </div>
    );
}

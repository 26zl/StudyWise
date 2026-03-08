/*
 * VarslingerSection - Varslingside for dashboardet
 * Deler data og lest/ulest med popup-toast via useVarsler og uiStore.
 */
"use client";

import { useState, useEffect } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { nb } from "date-fns/locale";
import {
    Bell,
    Clock,
    Megaphone,
    CalendarDays,
    AlertCircle,
    MapPin,
    CheckCircle2,
    CheckCheck,
} from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { FeilMelding } from "./FeilMelding";
import { toast } from "sonner";
import { useVarsler, type VarslingTab } from "../hooks/useVarsler";
import { formaterTid, type FristStatus } from "../lib/varsler";
import type { FristElement, KunngjoringElement, HendelseElement, VarslingElement } from "../lib/varsler";
import { KIOppsummering } from "./KIOppsummering";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";

interface VarslingerSectionProps {
    harCanvasToken?: boolean;
}
// Varslinger-seksjonen håndterer visning av frister, kunngjøringer og hendelser, med faner for filtrering.
function fristFarge(status: FristStatus) {
    if (status === "kritisk") return "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20";
    if (status === "snart") return "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20";
    return "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20";
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

    const {
        frister,
        kunngjøringer,
        hendelser,
        alleElementer,
        ulesteCount,
        markAllAsLest,
        isLoading,
        isError,
        hasPartialError,
        error,
        isHydrated,
    } = useVarsler(harCanvasToken);

    // Når bruker åpner varslinger-siden, markér alle som lest (synk med popup)
    useEffect(() => {
        if (harCanvasToken && isHydrated && !isError && alleElementer.length > 0) {
            markAllAsLest();
        }
    }, [harCanvasToken, isHydrated, isError, alleElementer.length, markAllAsLest]);

    const tabs: { id: VarslingTab; label: string; antall: number }[] = [
        { id: "alle", label: "Alle", antall: alleElementer.length },
        { id: "frister", label: "Frister", antall: frister.length },
        { id: "kunngjøringer", label: "Kunngjøringer", antall: kunngjøringer.length },
        { id: "hendelser", label: "Hendelser", antall: hendelser.length },
    ];

    const aktiveListe =
        aktivTab === "alle" ? alleElementer
            : aktivTab === "frister" ? frister
            : aktivTab === "kunngjøringer" ? kunngjøringer
            : hendelser;

    if (!harCanvasToken) {
        return (
            <div className="p-6 sm:p-8">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                    <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                        Du må lagre en Canvas API-token for å se varslinger.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            <div className="flex items-center gap-3">
                <Bell className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                    Varslinger
                </h1>
            </div>

            {!isError && alleElementer.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => {
                            markAllAsLest();
                            if (ulesteCount > 0) toast.success("Alle varsler markert som lest");
                        }}
                        disabled={ulesteCount === 0}
                        className={`
                            inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                            ${ulesteCount === 0
                                ? "text-slate-400 dark:text-slate-500 cursor-default"
                                : "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                            }
                        `}
                    >
                        <CheckCheck className="w-4 h-4 shrink-0" />
                        {ulesteCount === 0 ? "Alle markert som lest" : "Marker alle som lest"}
                    </button>
                </div>
            )}

            {hasPartialError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            {lagBrukervennligFeilmelding(
                                error instanceof Error ? error : null,
                                { canvas: true },
                                "Noen varsler kunne ikke lastes. Resten vises under.",
                            )}
                        </p>
                    </div>
                </div>
            )}

            {!isError && (
                <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => settAktivTab(tab.id)}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                aktivTab === tab.id
                                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                        >
                            {tab.label}
                            {ulesteCount > 0 && (
                                <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold ${
                                    aktivTab === tab.id
                                        ? "bg-blue-600 dark:bg-blue-500 text-white"
                                        : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                }`}>
                                    {tab.antall}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : isError ? (
                <FeilMelding
                    melding={lagBrukervennligFeilmelding(
                        error instanceof Error ? error : null,
                        { canvas: true },
                        "Kunne ikke laste varsler. Prøv igjen.",
                    )}
                />
            ) : aktiveListe.length === 0 ? (
                <div className="text-center py-12">
                    <Bell className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Ingen {aktivTab === "alle" ? "varslinger" : aktivTab} for øyeblikket.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {aktiveListe.map((element) => (
                        <VarslingKort key={element.id} element={element} />
                    ))}
                </div>
            )}
        </div>
    );
}

function VarslingKort({ element }: { element: VarslingElement }) {
    if (element.type === "frist") return <FristKort frist={element} />;
    if (element.type === "kunngjoring") return <KunngjoringKort kunngjoring={element} />;
    return <HendelseKort hendelse={element} />;
}

function FristKort({ frist }: { frist: FristElement }) {
    const tidTekst = formaterTid(frist.timerIgjen);

    return (
        <div className={`p-4 rounded-lg border ${fristFarge(frist.status)} transition-colors`}>
            <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3 className="font-medium text-slate-900 dark:text-white truncate">
                                {frist.tittel}
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span>{frist.emne}</span>
                                {frist.erInnlevert && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Innlevert
                                    </span>
                                )}
                            </p>
                        </div>
                        <span className={`shrink-0 px-2 py-1 rounded-md text-xs font-semibold ${fristBadgeFarge(frist.status)}`}>
                            {tidTekst} igjen
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Frist: {format(frist.dato, "d. MMMM yyyy 'kl.' HH:mm", { locale: nb })}
                    </p>
                </div>
            </div>
        </div>
    );
}

function KunngjoringKort({ kunngjoring }: { kunngjoring: KunngjoringElement }) {
    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
                <Megaphone className="w-5 h-5 mt-0.5 shrink-0 text-purple-500 dark:text-purple-400" />
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-900 dark:text-white">
                        {kunngjoring.tittel}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {kunngjoring.emne} &middot; {formatDistanceToNow(kunngjoring.dato, { addSuffix: true, locale: nb })}
                    </p>
                    <KIOppsummering tekst={kunngjoring.melding} storrelse="sm" />
                </div>
            </div>
        </div>
    );
}

function HendelseKort({ hendelse }: { hendelse: HendelseElement }) {
    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
                <CalendarDays className="w-5 h-5 mt-0.5 shrink-0 text-blue-500 dark:text-blue-400" />
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-900 dark:text-white">
                        {hendelse.tittel}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {format(hendelse.dato, "d. MMM HH:mm", { locale: nb })}
                            {hendelse.sluttDato && ` – ${format(hendelse.sluttDato, "HH:mm")}`}
                        </span>
                        {hendelse.lokasjon && (
                            <span className="flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {hendelse.lokasjon}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

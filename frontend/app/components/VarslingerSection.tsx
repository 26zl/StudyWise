/*
 * VarslingerSection - Universal varslingside for dashboardet
 * Samler frister, kunngjøringer og hendelser med tab-navigasjon
 */
"use client";

import { useState, useMemo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { nb } from "date-fns/locale";
import {
    Bell,
    Clock,
    Megaphone,
    CalendarDays,
    AlertCircle,
    MapPin,
    Loader2,
    CheckCircle2,
} from "lucide-react";
import {
    useCanvasAllAssignments,
    useCanvasAnnouncements,
    useCanvasUpcomingEvents,
    useCanvasCourses,
    type AssignmentMedEmne,
} from "../canvas/canvas-api";
import { FRIST_VINDU_TIMER, klassifiserFrist, formaterTid, type FristStatus } from "../lib/fristUtils";
import { KIOppsummering } from "./KIOppsummering";

// Tab-typer
type VarslingTab = "alle" | "frister" | "kunngjøringer" | "hendelser";

// Interfaces for varslingsobjekter
interface VarslingerSectionProps {
    harCanvasToken?: boolean;
}

// Fristoppgave med beregnet urgency
interface FristElement {
    type: "frist";
    id: string;
    tittel: string;
    emne: string;
    dato: Date;
    timerIgjen: number;
    status: FristStatus;
    erInnlevert: boolean;
}
// Kunngjøring fra Canvas
interface KunngjoringElement {
    type: "kunngjoring";
    id: string;
    tittel: string;
    emne: string;
    dato: Date;
    melding: string;
}
// Hendelse i kalenderen
interface HendelseElement {
    type: "hendelse";
    id: string;
    tittel: string;
    dato: Date;
    sluttDato: Date | null;
    lokasjon: string | null;
}
// Unionstype for alle varslingsobjekter
type VarslingElement = FristElement | KunngjoringElement | HendelseElement;

// Fargekoder for fristnivå
function fristFarge(status: FristStatus) {
    if (status === "kritisk") return "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20";
    if (status === "snart") return "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20";
    return "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20";
}
// Hovedkomponenten for Varslinger-seksjonen
function fristBadgeFarge(status: FristStatus) {
    if (status === "kritisk") return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
    if (status === "snart") return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300";
    return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
}
// Hovedkomponenten for Varslinger-seksjonen
export function VarslingerSection({ harCanvasToken = false }: VarslingerSectionProps) {
    const [aktivTab, settAktivTab] = useState<VarslingTab>("alle");

    const assignmentsQuery = useCanvasAllAssignments({ enabled: harCanvasToken });
    const announcementsQuery = useCanvasAnnouncements(harCanvasToken);
    const eventsQuery = useCanvasUpcomingEvents(harCanvasToken);
    const coursesQuery = useCanvasCourses(harCanvasToken);

    const isLoading = assignmentsQuery.isLoading || announcementsQuery.isLoading || eventsQuery.isLoading;

    // Map context_code → emnenavn for kunngjøringer
    const emneNavnMap = useMemo(() => {
        const courses = coursesQuery.data?.courses ?? [];
        const map = new Map<string, string>();
        for (const c of courses) {
            map.set(`course_${c.id}`, c.name);
        }
        return map;
    }, [coursesQuery.data]);

    // Frister innen 72 timer
    const frister: FristElement[] = useMemo(() => {
        const oppgaver = assignmentsQuery.data ?? [];
        const nå = Date.now();
        return oppgaver
            .filter((o: AssignmentMedEmne) => {
                if (!o.due_at) return false;
                const timer = (new Date(o.due_at).getTime() - nå) / (1000 * 60 * 60);
                return timer > 0 && timer <= FRIST_VINDU_TIMER;
            })
            .map((o: AssignmentMedEmne) => {
                const timerIgjen = (new Date(o.due_at!).getTime() - nå) / (1000 * 60 * 60);
                const erInnlevert = !!(o.submission && (
                    o.submission.workflow_state === "submitted" ||
                    o.submission.workflow_state === "graded" ||
                    o.submission.workflow_state === "pending_review"
                ));
                return {
                    type: "frist" as const,
                    id: `frist-${o.id}`,
                    tittel: o.name,
                    emne: o.course_name,
                    dato: new Date(o.due_at!),
                    timerIgjen,
                    status: klassifiserFrist(timerIgjen),
                    erInnlevert,
                };
            })
            .sort((a, b) => a.timerIgjen - b.timerIgjen);
    }, [assignmentsQuery.data]);

    // Kunngjøringer
    const kunngjøringer: KunngjoringElement[] = useMemo(() => {
        const announcements = announcementsQuery.data?.announcements ?? [];
        return announcements.map((a) => ({
            type: "kunngjoring" as const,
            id: `kunngjoring-${a.id}`,
            tittel: a.title,
            emne: (a.context_code && emneNavnMap.get(a.context_code)) ?? a.context_code?.replace("course_", "Emne ") ?? "",
            dato: a.posted_at ? new Date(a.posted_at) : new Date(),
            melding: a.message ?? "",
        }));
    }, [announcementsQuery.data, emneNavnMap]);

    // Hendelser
    const hendelser: HendelseElement[] = useMemo(() => {
        const events = eventsQuery.data?.events ?? [];
        return events
            .filter((e) => e.start_at)
            .map((e) => ({
                type: "hendelse" as const,
                id: `hendelse-${e.id}`,
                tittel: e.title,
                dato: new Date(e.start_at!),
                sluttDato: e.end_at ? new Date(e.end_at) : null,
                lokasjon: e.location_name ?? null,
            }))
            .sort((a, b) => a.dato.getTime() - b.dato.getTime());
    }, [eventsQuery.data]);

    // Alle elementer kronologisk blandet
    const alleElementer: VarslingElement[] = useMemo(() => {
        return [...frister, ...kunngjøringer, ...hendelser].sort(
            (a, b) => a.dato.getTime() - b.dato.getTime()
        );
    }, [frister, kunngjøringer, hendelser]);

    // Tab-data
    const tabs: { id: VarslingTab; label: string; antall: number }[] = [
        { id: "alle", label: "Alle", antall: alleElementer.length },
        { id: "frister", label: "Frister", antall: frister.length },
        { id: "kunngjøringer", label: "Kunngjøringer", antall: kunngjøringer.length },
        { id: "hendelser", label: "Hendelser", antall: hendelser.length },
    ];
    // Velg aktive elementer basert på valgt tab
    const aktiveListe = aktivTab === "alle" ? alleElementer
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
            {/* Header */}
            <div className="flex items-center gap-3">
                <Bell className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                    Varslinger
                </h1>
            </div>

            {/* Tab-navigasjon */}
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
                        <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold ${
                            aktivTab === tab.id
                                ? "bg-blue-600 dark:bg-blue-500 text-white"
                                : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                        }`}>
                            {tab.antall}
                        </span>
                    </button>
                ))}
            </div>

            {/* Innhold */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
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

// Individuelt varslingskort
function VarslingKort({ element }: { element: VarslingElement }) {
    if (element.type === "frist") return <FristKort frist={element} />;
    if (element.type === "kunngjoring") return <KunngjoringKort kunngjoring={element} />;
    return <HendelseKort hendelse={element} />;
}
// Kort for fristoppgave
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
// Kort for kunngjøring
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
// Kort for kalenderhendelse
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

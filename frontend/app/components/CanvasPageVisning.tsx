/*
* CanvasPageVisning-komponent
* Håndterer visning av en enkelt Canvas-side med tittel, publiseringsdato og innhold
*/
"use client";

import { useState, useCallback, useEffect, type JSX } from "react";
import { useCanvasPage } from "../canvas/canvas-api";
import { ArrowLeft, Calendar, Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { createCanvasHtmlParser, parseCanvasHtml } from "../canvas/canvasHtml";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { useKIOppsummering, type KIOppsummeringResponse } from "../ki/ki-api";
import { showToast } from "./Toaster";

// Props for CanvasPageVisning komponenten
interface CanvasPageVisningProps {
    courseId: number;
    pageId: string | number; // page_url eller page_id
    onBack: () => void;
}

// HTML parser alternativer (samme som i CanvasSection, kan evt. flyttes til en shared utility)
const htmlParser = createCanvasHtmlParser();

// KI-oppsummering av sideinnhold
function SideOppsummering({ tekst }: { tekst: string }) {
    const { oppsummer, isPending, data, error } = useKIOppsummering();
    const [aapen, settAapen] = useState(false);
    const [resultat, settResultat] = useState<KIOppsummeringResponse | null>(null);
    const harTekst = tekst.trim().length > 0;

    const handleOppsummer = useCallback(() => {
        if (resultat) {
            settAapen((v) => !v);
            return;
        }
        if (!harTekst) return;
        oppsummer(tekst, {
            type: "begge",
            onSuccess: (data) => {
                settResultat(data);
                settAapen(true);
            },
            onError: (err) => {
                showToast.error("Kunne ikke oppsummere", err.message);
            },
        });
    }, [tekst, oppsummer, resultat, harTekst]);

    useEffect(() => {
        if (data?.suksess && !resultat) {
            settResultat(data);
            settAapen(true);
        }
    }, [data, resultat]);

    return (
        <div className="px-8 pb-6">
            <button
                onClick={handleOppsummer}
                disabled={isPending || !harTekst}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50"
            >
                {isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : (
                    <Sparkles size={16} />
                )}
                {resultat ? (aapen ? "Skjul oppsummering" : "Vis oppsummering") : harTekst ? "Oppsummer med KI" : "Ingen innhold å oppsummere"}
                {resultat && (aapen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>

            {aapen && resultat && (
                <div className="mt-3 p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 space-y-3">
                    {resultat.oppsummering && (
                        <div>
                            <h4 className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-1">
                                TL;DR
                            </h4>
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                {resultat.oppsummering}
                            </p>
                        </div>
                    )}
                    {resultat.handlinger && resultat.handlinger.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-1">
                                Hovedpunkter
                            </h4>
                            <ul className="space-y-1">
                                {resultat.handlinger.map((punkt, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-purple-500 mt-0.5 shrink-0" />
                                        {punkt}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {!resultat.oppsummering && (!resultat.handlinger || resultat.handlinger.length === 0) && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Ingen oppsummering tilgjengelig.
                        </p>
                    )}
                </div>
            )}

            {error && !resultat && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error.message}</p>
            )}
        </div>
    );
}

// Hovedkomponenten for visning av en Canvas-side
export function CanvasPageVisning({ courseId, pageId, onBack }: CanvasPageVisningProps): JSX.Element | null {
    const { data: page, isLoading, isError, error } = useCanvasPage(courseId, pageId);

    if (isLoading) {
        return (
            <div className="p-8 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                <div className="space-y-3">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
                </div>
            </div>
        );
    }
    // Håndter feil ved lasting av side
    if (isError) {
        const errorMessage = error instanceof Error ? error.message : "Ukjent feil";
        return (
            <div className="p-8 text-center">
                <p className="text-red-500">Kunne ikke laste siden: {errorMessage}</p>
                <button
                    onClick={onBack}
                    className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm"
                >
                    Gå tilbake
                </button>
            </div>
        );
    }
    if (!page) return null;

    // Hovedrendering av siden
    return (
        <div className="max-w-4xl mx-auto">
            <button
                onClick={onBack}
                className="flex items-center gap-2 mb-6 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
                <ArrowLeft size={16} />
                Tilbake til moduler
            </button>

            <article className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <header className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                        {page.title}
                    </h1>
                    
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                        {page.created_at && (
                            <div className="flex items-center gap-1.5">
                                <Calendar size={14} />
                                <span>Publisert {format(new Date(page.created_at), "d. MMMM yyyy", { locale: nb })}</span>
                            </div>
                        )}
                    </div>
                </header>

                {/* KI-oppsummering av sideinnhold – alltid synlig per modul */}
                <SideOppsummering tekst={(page.body && page.body.trim()) || page.title || ""} />

                <div className="p-8 prose prose-slate dark:prose-invert max-w-none">
                     {/*
                        OBS: Canvas HTML innhold kan være komplekst.
                        Vi bruker DOMPurify for sikkerhet og html-react-parser for å kunne tilpasse elementer (f.eks linker).
                     */}
                    {parseCanvasHtml(page.body, htmlParser)}
                </div>
            </article>
        </div>
    );
}

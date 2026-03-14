/*
* CanvasPageVisning-komponent
* Håndterer visning av en enkelt Canvas-side med tittel, publiseringsdato og innhold
*/
"use client";

import type { JSX } from "react";
import { useCanvasPage } from "@/app/canvas/canvas-api";
import { ArrowLeft, Calendar } from "lucide-react";
import { createCanvasHtmlParser, parseCanvasHtml } from "@/app/canvas/canvasHtml";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { KIOppsummering } from "@/app/components/ki/KIOppsummering";

// Props for CanvasPageVisning komponenten
interface CanvasPageVisningProps {
    courseId: number;
    pageId: string | number; // page_url eller page_id
    onBack: () => void;
}

// HTML parser alternativer (samme som i CanvasSection, kan evt. flyttes til en shared utility)
const htmlParser = createCanvasHtmlParser();

// Hovedkomponenten for visning av en Canvas-side
export function CanvasPageVisning({ courseId, pageId, onBack }: CanvasPageVisningProps): JSX.Element | null {
    const { data: page, isLoading, isError, error } = useCanvasPage(courseId, pageId);

    if (isLoading) {
        return (
            <div className="p-8">
                <LoadingView text="Laster siden..." fullPage={false} />
            </div>
        );
    }
    if (isError) {
        const feilMelding = lagBrukervennligFeilmelding(
            error instanceof Error ? error : null,
            { canvas: true },
            "Kunne ikke laste siden. Prøv igjen."
        );
        return (
            <div className="p-8 space-y-4">
                <FeilMelding melding={feilMelding} />
                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-lg px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm transition-colors"
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
                <KIOppsummering tekst={(page.body && page.body.trim()) || page.title || ""} storrelse="lg" />

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

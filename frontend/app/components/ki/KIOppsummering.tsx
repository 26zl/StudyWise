/*
 * KIOppsummering - Delt oppsummeringskomponent for KI
 * Erstatter KunngjoringOppsummering, SideOppsummering og KalenderOppsummering
 * Bruker kiStore for bakgrunnsgenerering — overlever navigering mellom visninger.
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2, RefreshCw } from "lucide-react";
import type { KIOppsummeringResponse } from "@/app/ki/ki-api";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { useKIStore } from "@/app/store/kiStore";
import { simpleHash } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";

// Hvor lenge en oppsummering er gyldig før den bør regenereres (2 dager).
// Canvas-innhold (kunngjøringer, moduler osv.) kan endre seg — TTL sikrer fersk data.
const OPPSUMMERING_TTL_MS = 2 * 24 * 60 * 60 * 1000;

// Render `**bold**` segmenter som <strong> uten å dra inn full markdown-parser.
// Claude bruker av og til markdown-fet skrift på titler/nøkkelord, og uten dette
// vises stjernene rått i UI-en (observert i USN-stillingsannonsen).
function renderInlineBold(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        const match = part.match(/^\*\*([^*]+)\*\*$/);
        return match ? <strong key={i}>{match[1]}</strong> : <span key={i}>{part}</span>;
    });
}

// Størrelseskonfigurasjoner
const storrelser = {
    sm: {
        knapp: "px-2.5 py-1 text-xs",
        ikonKlasse: "w-3.5 h-3.5",
        boks: "p-3 space-y-2",
        overskrift: "text-[10px]",
        tekst: "text-xs",
        sjekkIkon: "w-3 h-3",
        feil: "text-[10px]",
        feilMargin: "mt-1",
    },
    md: {
        knapp: "px-3 py-1.5 text-xs",
        ikonKlasse: undefined as undefined,
        ikonStr: 14,
        boks: "p-4 space-y-3",
        overskrift: "text-xs",
        tekst: "text-sm",
        sjekkIkon: undefined as undefined,
        sjekkIkonStr: 14,
        feil: "text-xs",
        feilMargin: "mt-2",
    },
    lg: {
        knapp: "px-4 py-2 text-sm",
        ikonKlasse: undefined as undefined,
        ikonStr: 16,
        boks: "p-4 space-y-3",
        overskrift: "text-xs",
        tekst: "text-sm",
        sjekkIkon: undefined as undefined,
        sjekkIkonStr: 14,
        feil: "text-xs",
        feilMargin: "mt-2",
    },
} as const;

// Props for KIOppsummering komponenten
interface KIOppsummeringProps {
    tekst: string;
    storrelse: "sm" | "md" | "lg";
    variant?: "default" | "inline";
}

function getSummaryLabels(language: "nb" | "en") {
    if (language === "en") {
        return {
            summaryHeading: "TL;DR",
            keyPointsHeading: "Key points",
            summarizeAgain: "Summarize again",
            hideSummary: "Hide summary",
            showSummary: "Show summary",
            summarizeWithAi: "Summarize with AI",
            noContentToSummarize: "No content to summarize",
            noSummaryAvailable: "No summary available.",
            refreshExpired: "The content may have changed - click to refresh",
        };
    }

    return {
        summaryHeading: "Kort fortalt",
        keyPointsHeading: "Hovedpunkter",
        summarizeAgain: "Oppsummer på nytt",
        hideSummary: "Skjul oppsummering",
        showSummary: "Vis oppsummering",
        summarizeWithAi: "Oppsummer med KI",
        noContentToSummarize: "Ingen innhold å oppsummere",
        noSummaryAvailable: "Ingen oppsummering tilgjengelig.",
        refreshExpired: "Innholdet kan ha endret seg - klikk for å oppdatere",
    };
}

// Hovedkomponenten for KI-oppsummering
export function KIOppsummering({ tekst, storrelse, variant = "default" }: KIOppsummeringProps) {
    const { language } = useLanguage();
    const labels = getSummaryLabels(language);
    const [åpen, settÅpen] = useState(false);
    const [resultat, settResultat] = useState<KIOppsummeringResponse | null>(null);
    const [genererTidspunkt, settGenererTidspunkt] = useState<number | null>(null);
    const [erUtløpt, settErUtløpt] = useState(false);
    const tekstRef = useRef(tekst);
    tekstRef.current = tekst;
    const harTekst = tekst.trim().length > 0;

    // Bakgrunnsgenerering via zustand-store
    const key = harTekst ? simpleHash(tekst.trim()) : "";
    const bgJob = useKIStore((s) => s.oppsummeringJobs[key]);
    const startOppsummering = useKIStore((s) => s.startOppsummering);
    const clearOppsummering = useKIStore((s) => s.clearOppsummering);
    const visLoading = bgJob?.status === "pending";

    const s = storrelser[storrelse];

    // Hydrér fra bakgrunnsjobb (zustand store) — f.eks. etter navigering tilbake
    useEffect(() => {
        if (!bgJob || resultat) return;

        if (bgJob.status === "success" && bgJob.result) {
            settResultat(bgJob.result);
            settGenererTidspunkt(Date.now());
            settErUtløpt(false);
            settÅpen(true);
            clearOppsummering(key);
        } else if (bgJob.status === "error") {
            clearOppsummering(key);
        }
    }, [bgJob, key, resultat, clearOppsummering]);

    // TTL-timer: marker oppsummeringen som utløpt etter OPPSUMMERING_TTL_MS
    useEffect(() => {
        if (!genererTidspunkt) return;
        const gjenstående = OPPSUMMERING_TTL_MS - (Date.now() - genererTidspunkt);
        if (gjenstående <= 0) {
            settErUtløpt(true);
            return;
        }
        const timer = window.setTimeout(() => settErUtløpt(true), gjenstående);
        return () => window.clearTimeout(timer);
    }, [genererTidspunkt]);

    // Håndterer klikk på oppsummeringsknappen
    const handleOppsummer = useCallback(() => {
        if (resultat && !erUtløpt) {
            settÅpen((v) => !v);
            return;
        }
        const currentTekst = tekstRef.current.trim();
        if (!currentTekst) return;
        // Nullstill gammel data ved regenerering
        settResultat(null);
        settGenererTidspunkt(null);
        settErUtløpt(false);
        startOppsummering(currentTekst);
    }, [startOppsummering, resultat, erUtløpt]);

    // Regenerer-knapp handler (eksplisitt regenerering)
    const handleRegenerer = useCallback(() => {
        const currentTekst = tekstRef.current.trim();
        if (!currentTekst) return;
        settResultat(null);
        settGenererTidspunkt(null);
        settErUtløpt(false);
        startOppsummering(currentTekst);
    }, [startOppsummering]);

    // Bestemmer knappetekst basert på tilstand
    const isInline = variant === "inline";
    const wrapperClass = isInline
        ? `self-center ${åpen && resultat ? "w-full basis-full order-10" : ""}`
        : storrelse === "lg" ? "px-8 pb-6" : storrelse === "md" ? "mt-3" : "mt-2";

    // Ikon-rendering basert på størrelse
    const spinnerClass = "text-blue-600 dark:text-blue-400 animate-spin";
    const renderIkon = (SpinnerEllerIkon: typeof Loader2 | typeof Sparkles) => {
        if (storrelse === "sm") {
            return <SpinnerEllerIkon className={`${s.ikonKlasse} ${SpinnerEllerIkon === Loader2 ? spinnerClass : ""}`} />;
        }
        const str = storrelse === "md" ? 14 : 16;
        return <SpinnerEllerIkon size={str} className={SpinnerEllerIkon === Loader2 ? spinnerClass : ""} />;
    };

    // Chevron-rendering basert på størrelse
    const renderChevron = (Chevron: typeof ChevronUp | typeof ChevronDown) => {
        if (storrelse === "sm") {
            return <Chevron className="w-3.5 h-3.5" />;
        }
        return <Chevron size={14} />;
    };

    // Sjekk-ikon-rendering basert på størrelse
    const renderSjekkIkon = () => {
        if (storrelse === "sm") {
            return <CheckCircle2 className="w-3 h-3 text-purple-500 dark:text-purple-400 mt-0.5 shrink-0" />;
        }
        return <CheckCircle2 size={14} className="text-purple-500 dark:text-purple-400 mt-0.5 shrink-0" />;
    };

    // Bestemmer knappetekst basert på tilstand
    const knappTekst = resultat
        ? erUtløpt
            ? labels.summarizeAgain
            : (åpen ? labels.hideSummary : labels.showSummary)
        : harTekst ? labels.summarizeWithAi : labels.noContentToSummarize;

    const errorMessage = bgJob?.status === "error" ? bgJob.error : null;

    return (
        <div className={wrapperClass}>
            <button
                type="button"
                onClick={handleOppsummer}
                disabled={visLoading || !harTekst}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50 ${s.knapp}`}
            >
                {renderIkon(visLoading ? Loader2 : Sparkles)}
                {knappTekst}
                {resultat && renderChevron(åpen ? ChevronUp : ChevronDown)}
            </button>

            {åpen && resultat && (
                <div className={`mt-2 sm:mt-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 ${s.boks}`}>
                    {resultat.oppsummering && (
                        <div>
                            <h4 className={`${s.overskrift} font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5 sm:mb-1`}>
                                {labels.summaryHeading}
                            </h4>
                            <p className={`${s.tekst} text-slate-700 dark:text-slate-300 leading-snug`}>
                                {renderInlineBold(resultat.oppsummering)}
                            </p>
                        </div>
                    )}
                    {resultat.handlinger && resultat.handlinger.length > 0 && (
                        <div>
                            <h4 className={`${s.overskrift} font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5 sm:mb-1`}>
                                {labels.keyPointsHeading}
                            </h4>
                            <ul className="space-y-1 sm:space-y-1.5">
                                {resultat.handlinger.map((punkt, i) => {
                                    const medForklaring = punkt.split(/\s+[–—]\s+/);
                                    const hoveddel = medForklaring[0] ?? punkt;
                                    const forklaring = medForklaring.length > 1 ? medForklaring.slice(1).join(" – ").trim() : null;
                                    return (
                                        <li key={i} className={`flex items-start gap-1.5 sm:gap-2 ${s.tekst} text-slate-700 dark:text-slate-300`}>
                                            {renderSjekkIkon()}
                                            <span>
                                                {renderInlineBold(hoveddel)}
                                                {forklaring && (
                                                    <span className="block text-slate-600 dark:text-slate-400 mt-0.5 pl-5 sm:pl-6 text-[0.9em]">
                                                        {renderInlineBold(forklaring)}
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                    {!resultat.oppsummering && (!resultat.handlinger || resultat.handlinger.length === 0) && (
                        <p className={`${s.tekst} text-slate-500 dark:text-slate-400`}>
                            {labels.noSummaryAvailable}
                        </p>
                    )}
                    {erUtløpt && (
                        <button
                            type="button"
                            onClick={handleRegenerer}
                            disabled={visLoading}
                            className={`inline-flex items-center gap-1.5 ${s.feil} text-purple-500 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors disabled:opacity-50`}
                        >
                            <RefreshCw className="w-3 h-3" />
                            {labels.refreshExpired}
                        </button>
                    )}
                </div>
            )}

            {errorMessage && !resultat && (
                <p className={`${s.feilMargin} ${s.feil} text-red-500 dark:text-red-400`}>
                    {lagBrukervennligFeilmelding(new Error(errorMessage), { ki: true })}
                </p>
            )}
        </div>
    );
}

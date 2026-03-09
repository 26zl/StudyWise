/*
 * KIOppsummering - Delt oppsummeringskomponent for KI
 * Erstatter KunngjoringOppsummering, SideOppsummering og KalenderOppsummering
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { useKIOppsummering as useKIOppsummeringHook, type KIOppsummeringResponse } from "../ki/ki-api";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";

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

// Hovedkomponenten for KI-oppsummering
export function KIOppsummering({ tekst, storrelse, variant = "default" }: KIOppsummeringProps) {
    const { oppsummer, isPending, data, error } = useKIOppsummeringHook();
    const [åpen, settÅpen] = useState(false);
    const [resultat, settResultat] = useState<KIOppsummeringResponse | null>(null);
    const [requesting, setRequesting] = useState(false);
    const tekstRef = useRef(tekst);
    tekstRef.current = tekst;
    const isMountedRef = useRef(true);
    const harTekst = tekst.trim().length > 0;
    const visLoading = isPending || requesting;

    const s = storrelser[storrelse];

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Håndterer klikk på oppsummeringsknappen – stabil callback, umiddelbar loading-feedback
    const handleOppsummer = useCallback(() => {
        if (resultat) {
            settÅpen((v) => !v);
            return;
        }
        const currentTekst = tekstRef.current.trim();
        if (!currentTekst) return;
        setRequesting(true);
        oppsummer(currentTekst, {
            type: "begge",
            onSuccess: (data) => {
                if (!isMountedRef.current) return;
                setRequesting(false);
                settResultat(data);
                settÅpen(true);
            },
            onError: () => {
                if (!isMountedRef.current) return;
                setRequesting(false);
            },
        });
    }, [oppsummer, resultat]);

    // Oppdaterer resultat og åpner oppsummering når data kommer inn (fallback for cache/race)
    useEffect(() => {
        if (!isMountedRef.current) return;
        if (data?.suksess && !resultat) {
            setRequesting(false);
            settResultat(data);
            settÅpen(true);
        }
    }, [data, resultat]);

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
        ? (åpen ? "Skjul oppsummering" : "Vis oppsummering")
        : harTekst ? "Oppsummer med KI" : "Ingen innhold å oppsummere";

    // Håndterer loading state
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
                                TL;DR
                            </h4>
                            <p className={`${s.tekst} text-slate-700 dark:text-slate-300 leading-snug`}>
                                {resultat.oppsummering}
                            </p>
                        </div>
                    )}
                    {resultat.handlinger && resultat.handlinger.length > 0 && (
                        <div>
                            <h4 className={`${s.overskrift} font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5 sm:mb-1`}>
                                Hovedpunkter
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
                                                {hoveddel}
                                                {forklaring && (
                                                    <span className="block text-slate-600 dark:text-slate-400 mt-0.5 pl-5 sm:pl-6 text-[0.9em]">
                                                        {forklaring}
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
                            Ingen oppsummering tilgjengelig.
                        </p>
                    )}
                </div>
            )}

            {error && !resultat && (
                <p className={`${s.feilMargin} ${s.feil} text-red-500 dark:text-red-400`}>
                    {lagBrukervennligFeilmelding(error instanceof Error ? error : null, { ki: true })}
                </p>
            )}
        </div>
    );
}

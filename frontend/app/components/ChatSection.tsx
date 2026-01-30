/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Sparkles, Paperclip, FileText, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useKITestTilkobling, useKIChat, useKIPdfAnalyse } from "../ki/ki-api";

// Meldings-typer
interface Melding {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: Date;
    pdfNavn?: string; // For å vise at melding inkluderte PDF
}

// Forslag til spørsmål
const forslag = [
    "Hva er de viktigste fristene mine denne uken?",
    "Forklar konseptet fra siste forelesning",
    "Hjelp meg planlegge studieøkten min",
    "Vis meg kunngjøringer fra mine emner",
];

// ChatSection komponent
export function ChatSection() {
    const [meldinger, settMeldinger] = useState<Melding[]>([]);
    const [tekstInput, settTekstInput] = useState("");
    const [skriver, settSkriver] = useState(false);
    const [valgtPdf, settValgtPdf] = useState<File | null>(null);
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);
    const filInputRef = useRef<HTMLInputElement>(null);

    // KI tilkoblingstest 
    const {
        isError: erTilkoblingsFeil
    } = useKITestTilkobling();

    // KI chat hook
    const { sendMelding: sendTilAPI } = useKIChat();
    
    // PDF analyse hook
    const { analyserPdf } = useKIPdfAnalyse();

    // Auto-scroll 
    const scrollTilBunn = () => {
        meldingerSluttRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    // Scroll til bunn når meldinger oppdateres eller skriver-status endres
    useEffect(() => {
        scrollTilBunn();
    }, [meldinger, skriver]);

    // Auto-resize textarea
    useEffect(() => {
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
            tekstInputRef.current.style.height = `${Math.min(tekstInputRef.current.scrollHeight, 150)}px`;
        }
    }, [tekstInput]);

    const sendMelding = async () => {
        if (!tekstInput.trim() || skriver) return;

        const brukerMeldingInnhold = tekstInput.trim();
        settTekstInput("");

        // Reset høyde
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
        }

        // Legg til brukerens melding
        const brukerMelding: Melding = {
            id: Date.now().toString(),
            rolle: "user",
            innhold: brukerMeldingInnhold,
            tidsstempel: new Date(),
            pdfNavn: valgtPdf?.name,
        };

        settMeldinger((tidligere) => [...tidligere, brukerMelding]);
        settSkriver(true);

        // Hvis PDF er valgt, bruk PDF-analyse
        if (valgtPdf) {
            analyserPdf(
                valgtPdf,
                brukerMeldingInnhold,
                {
                    onSuccess: (data) => {
                        const aiMelding: Melding = {
                            id: (Date.now() + 1).toString(),
                            rolle: "assistant",
                            innhold: data.response,
                            tidsstempel: new Date(),
                        };
                        settMeldinger((tidligere) => [...tidligere, aiMelding]);
                        settSkriver(false);
                        settValgtPdf(null); // Fjern PDF etter analyse
                    },
                    onError: (error) => {
                        const feilMelding: Melding = {
                            id: (Date.now() + 1).toString(),
                            rolle: "assistant",
                            innhold: `Feil ved PDF-analyse: ${error.message}. Sjekk at filen er en gyldig PDF.`,
                            tidsstempel: new Date(),
                        };
                        settMeldinger((tidligere) => [...tidligere, feilMelding]);
                        settSkriver(false);
                    },
                }
            );
            return;
        }

        // Forbered meldingshistorikk for API
        const apiMeldinger = [...meldinger, brukerMelding].map((m) => ({
            role: m.rolle === "user" ? "user" : "assistant",
            content: m.innhold,
        }));

        // Send til ekte API
        sendTilAPI(apiMeldinger, {
            onSuccess: (data) => {
                const aiMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: data.response,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, aiMelding]);
                settSkriver(false);
            },
            onError: (error) => {
                const feilMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: `Feil: ${error.message}. Prov igjen senere.`,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, feilMelding]);
                settSkriver(false);
            },
        });
    };

    // Håndter PDF-valg
    const handterPdfValg = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fil = e.target.files?.[0];
        if (fil && fil.type === "application/pdf") {
            settValgtPdf(fil);
        }
        // Reset input så samme fil kan velges igjen
        if (filInputRef.current) {
            filInputRef.current.value = "";
        }
    };

    // Fjern valgt PDF
    const fjernValgtPdf = () => {
        settValgtPdf(null);
    };

    // Håndter tastetrykk (Enter for å sende, Shift+Enter for ny linje)
    const handterTastetrykk = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMelding();
        }
    };

    // Håndter forslag-klikk
    const handterForslag = (forslagTekst: string) => {
        settTekstInput(forslagTekst);
        tekstInputRef.current?.focus();
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            KI Assistent
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Din personlige studieassistent
                        </p>
                    </div>
                </div>
            </div>

            {/* Meldinger */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                {/* Tilkoblingsfeil */}
                {erTilkoblingsFeil && (
                    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                        <p className="text-sm text-red-700 dark:text-red-300">
                            ⚠️ Kunne ikke koble til KI-assistenten. Prøv igjen senere.
                        </p>
                    </div>
                )}

                {/* Tomme meldinger - vis forslag */}
                {meldinger.length === 0 && (
                    <div className="space-y-4">
                        <div className="text-center py-12">
                            <Bot className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                                Hei! Hvordan kan jeg hjelpe deg?
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Jeg kan hjelpe deg med studier, Canvas-innhold og mye mer
                            </p>
                        </div>

                        {/* Forslag */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                            {forslag.map((forslagTekst, index) => (
                                <button
                                    key={index}
                                    onClick={() => handterForslag(forslagTekst)}
                                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group"
                                >
                                    <p className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                                        {forslagTekst}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Meldingshistorikk */}
                {meldinger.map((melding) => (
                    <div
                        key={melding.id}
                        className={`flex gap-3 ${melding.rolle === "user" ? "justify-end" : "justify-start"}`}
                    >
                        {melding.rolle === "assistant" && (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4 text-white" />
                            </div>
                        )}

                        <div
                            className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                                melding.rolle === "user"
                                    ? "bg-blue-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white"
                            }`}
                        >
                            {/* Vis PDF-vedlegg hvis det finnes */}
                            {melding.pdfNavn && (
                                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-blue-500/30">
                                    <FileText className="w-4 h-4" />
                                    <span className="text-xs font-medium">{melding.pdfNavn}</span>
                                </div>
                            )}
                            {melding.rolle === "assistant" ? (
                                <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-blue-600 dark:prose-code:text-blue-400 prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                                    <ReactMarkdown>{melding.innhold}</ReactMarkdown>
                                </div>
                            ) : (
                                <p className="text-sm whitespace-pre-wrap">{melding.innhold}</p>
                            )}
                            <p
                                className={`text-xs mt-1 ${
                                    melding.rolle === "user"
                                        ? "text-blue-100"
                                        : "text-slate-500 dark:text-slate-400"
                                }`}
                            >
                                {melding.tidsstempel.toLocaleTimeString("no-NO", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </p>
                        </div>

                        {melding.rolle === "user" && (
                            <div className="w-8 h-8 rounded-full bg-slate-700 dark:bg-slate-600 flex items-center justify-center shrink-0">
                                <User className="w-4 h-4 text-white" />
                            </div>
                        )}
                    </div>
                ))}

                {/* Skriver indikator */}
                {skriver && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4 text-white" />
                        </div>
                        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3">
                            <div className="flex gap-1">
                                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={meldingerSluttRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 p-4 md:p-6 border-t border-slate-200 dark:border-slate-800">
                {/* Valgt PDF-visning */}
                {valgtPdf && (
                    <div className="mb-3 flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm text-blue-700 dark:text-blue-300 flex-1 truncate">
                            {valgtPdf.name}
                        </span>
                        <button
                            onClick={fjernValgtPdf}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
                            aria-label="Fjern PDF"
                        >
                            <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </button>
                    </div>
                )}
                
                <div className="flex gap-3">
                    {/* Skjult fil-input */}
                    <input
                        ref={filInputRef}
                        type="file"
                        accept="application/pdf"
                        onChange={handterPdfValg}
                        className="hidden"
                    />
                    
                    {/* PDF-knapp */}
                    <button
                        onClick={() => filInputRef.current?.click()}
                        disabled={skriver}
                        className="shrink-0 w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                        title="Last opp PDF"
                    >
                        <Paperclip className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </button>
                    
                    <textarea
                        ref={tekstInputRef}
                        value={tekstInput}
                        onChange={(e) => settTekstInput(e.target.value)}
                        onKeyDown={handterTastetrykk}
                        placeholder={valgtPdf ? "Still et sporsmal om PDF-en..." : "Skriv en melding..."}
                        disabled={skriver}
                        rows={1}
                        className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ maxHeight: "150px" }}
                    />
                    <button
                        onClick={sendMelding}
                        disabled={!tekstInput.trim() || skriver}
                        className="shrink-0 w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                    >
                        {skriver ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                        ) : (
                            <Send className="w-5 h-5 text-white" />
                        )}
                    </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Trykk Enter for å sende, Shift+Enter for ny linje
                </p>
            </div>
        </div>
    );
} 
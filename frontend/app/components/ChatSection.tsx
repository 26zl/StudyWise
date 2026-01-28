/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Sparkles } from "lucide-react";
import { useKITestTilkobling } from "../ki/ki-api";

// Meldings-typer
interface Melding {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: Date;
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
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);

    // KI tilkoblingstest 
    const {
        isError: erTilkoblingsFeil
    } = useKITestTilkobling();

    // Auto-scroll 
    const scrollTilBunn = () => {
        meldingerSluttRef.current?.scrollIntoView({ behavior: "smooth" });
    };

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
        if (!tekstInput.trim()) return;

        const brukerMeldingInnhold = tekstInput.trim();
        settTekstInput("");

        // Reset høyde
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
        }

        const brukerMelding: Melding = {
            id: Date.now().toString(),
            rolle: "user",
            innhold: brukerMeldingInnhold,
            tidsstempel: new Date(),
        };

        settMeldinger((tidligere) => [...tidligere, brukerMelding]);
        settSkriver(true);

        // Simulert AI respons (her ville vi optimalt kalt backend)
        setTimeout(() => {
            const aiMelding: Melding = {
                id: (Date.now() + 1).toString(),
                rolle: "assistant",
                innhold:
                    "Dette er en simulert respons. Backend-integrasjon kommer snart! Jeg ser at du spurte om: " +
                    brukerMeldingInnhold,
                tidsstempel: new Date(),
            };
            settMeldinger((tidligere) => [...tidligere, aiMelding]);
            settSkriver(false);
        }, 1000);
    };

    // Håndter tastetrykk (Enter for å sende, Shift+Enter for ny linje)
    const handterTastetrykk = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMelding();
        }
    };

    // Velg et forslag
    const velgForslag = (tekst: string) => {
        settTekstInput(tekst);
        if (tekstInputRef.current) {
            tekstInputRef.current.focus();
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50">
            {/* Header / Advarsel ved feil */}
            {erTilkoblingsFeil && (
                <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-100 dark:border-red-800 text-xs text-red-600 dark:text-red-400 text-center">
                    Kunne ikke koble til AI-tjenesten. Sjekk at backend kjører.
                </div>
            )}

            {/* Meldingsområde */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {meldinger.length === 0 ? (
                    // Velkomstskjerm
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-0 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-forwards">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-6 text-blue-600 dark:text-blue-400 shadow-sm shadow-blue-200 dark:shadow-none">
                            <Sparkles size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Hei, student! 👋
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 max-w-md mb-8">
                            Jeg er din personlige studieassistent. Jeg kan hjelpe deg med å holde
                            oversikt over Canvas, forklare fagstoff, eller planlegge dagen din.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                            {forslag.map((tekst, i) => (
                                <button
                                    key={i}
                                    onClick={() => velgForslag(tekst)}
                                    className="p-3 text-sm text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all text-slate-700 dark:text-slate-300"
                                >
                                    {tekst}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    // Meldingsliste
                    <>
                        {meldinger.map((melding) => {
                            const erBruker = melding.rolle === "user";
                            return (
                                <div
                                    key={melding.id}
                                    className={`flex gap-4 ${erBruker ? "justify-end" : "justify-start"}`}
                                >
                                    {!erBruker && (
                                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 mt-1">
                                            <Bot size={18} className="text-blue-600 dark:text-blue-400" />
                                        </div>
                                    )}

                                    <div
                                        className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-3.5 shadow-sm ${erBruker
                                            ? "bg-blue-600 text-white rounded-tr-none"
                                            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none border border-slate-100 dark:border-slate-700"
                                            }`}
                                    >
                                        <div className="text-slate-700 dark:text-slate-300 text-sm md:text-base leading-relaxed whitespace-pre-wrap">
                                            {melding.innhold}
                                        </div>
                                        <p
                                            className={`text-[10px] mt-1.5 opacity-70 ${erBruker ? "text-blue-100" : "text-slate-400"
                                                }`}
                                        >
                                            {melding.tidsstempel.toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </p>
                                    </div>

                                    {erBruker && (
                                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-1">
                                            <User size={18} className="text-slate-600 dark:text-slate-400" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Laste-indikator */}
                        {skriver && (
                            <div className="flex gap-4 justify-start animate-in fade-in duration-300">
                                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
                                    <Bot size={18} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2 shadow-sm">
                                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                                </div>
                            </div>
                        )}
                        <div ref={meldingerSluttRef} />
                    </>
                )}
            </div>

            {/* Input felt */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="max-w-4xl mx-auto relative flex items-end gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all shadow-sm">
                    <textarea
                        ref={tekstInputRef}
                        value={tekstInput}
                        onChange={(e) => settTekstInput(e.target.value)}
                        onKeyDown={handterTastetrykk}
                        placeholder="Spør om hva som helst..."
                        className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-48 py-2.5 px-3 text-slate-800 dark:text-white placeholder:text-slate-400"
                        rows={1}
                    />
                    <button
                        onClick={sendMelding}
                        disabled={!tekstInput.trim() || skriver}
                        className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        aria-label="Send melding"
                    >
                        {skriver ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2">
                    AI kan gjøre feil. Sjekk viktig informasjon.
                </p>
            </div>
        </div>
    );
}

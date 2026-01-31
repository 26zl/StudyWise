/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Sparkles, Clock, Plus } from "lucide-react";
import { useKITestTilkobling, useKIChat } from "../ki/ki-api";
import { CanvasContextSelector } from "./CanvasContextSelector";
import { useChatHistory } from "../hooks/useChatHistory";
import { ChatHistorySidebar } from "./ChatHistorySidebar";

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
    const [canvasContext, setCanvasContext] = useState("");
    const [showHistory, setShowHistory] = useState(false);
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);

    // KI tilkoblingstest 
    const {
        isError: erTilkoblingsFeil
    } = useKITestTilkobling();

    // KI chat hook
    const { sendMelding: sendTilAPI } = useKIChat();

    // Chat history hook + fjernet loadChat, blir aldri brukt
    const { chats, saveChat, deleteChat, clearAll } = useChatHistory();

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

    // Auto-save hver 5. melding
    useEffect(() => {
        if (meldinger.length > 0 && meldinger.length % 5 === 0) {
            saveChat(
                meldinger.map((m) => ({
                    rolle: m.rolle,
                    innhold: m.innhold,
                }))
            );
        }
    }, [meldinger.length]); // Bare avhengig av length, ikke saveChat

    // Ny samtale
    const nySamtale = () => {
        if (meldinger.length > 0) {
            saveChat(
                meldinger.map((m) => ({
                    rolle: m.rolle,
                    innhold: m.innhold,
                }))
            );
        }
        settMeldinger([]);
        setCanvasContext("");
    };

    // Last samtale
    const handleLoadChat = (chat: any) => {
        settMeldinger(
            chat.messages.map((m: any, i: number) => ({
                id: `${Date.now()}-${i}`,
                rolle: m.rolle,
                innhold: m.innhold,
                tidsstempel: new Date(),
            }))
        );
        setShowHistory(false);
    };

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
        };

        settMeldinger((tidligere) => [...tidligere, brukerMelding]);
        settSkriver(true);

        // Forbered meldingshistorikk for API
        const apiMeldinger = [
            // Legg til Canvas context hvis det finnes
            ...(canvasContext
                ? [{ role: "system" as const, content: `Canvas data:\n${canvasContext}` }]
                : []),
            // Historikk
            ...meldinger.map((m) => ({
                role: m.rolle === "user" ? ("user" as const) : ("assistant" as const),
                content: m.innhold,
            })),
            // Ny brukermelding
            { role: "user" as const, content: brukerMeldingInnhold },
        ];

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
                    innhold: `❌ Feil: ${error.message}. Prøv igjen senere.`,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, feilMelding]);
                settSkriver(false);
            },
        });
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
        <div className="h-full flex">
            {/* Sidebar - Chat History */}
            {showHistory && (
                <ChatHistorySidebar
                    chats={chats}
                    onLoadChat={handleLoadChat}
                    onDeleteChat={deleteChat}
                    onClearAll={clearAll}
                />
            )}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
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
                        
                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                            {/* History toggle */}
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                title="Samtalehistorikk"
                            >
                                <Clock className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                            
                            {/* New chat */}
                            <button
                                onClick={nySamtale}
                                disabled={meldinger.length === 0}
                                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Ny samtale"
                            >
                                <Plus className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Canvas Context Selector */}
                <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <CanvasContextSelector onContextChange={setCanvasContext} />
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
                                <p className="text-sm whitespace-pre-wrap">{melding.innhold}</p>
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
                    <div className="flex gap-3">
                        <textarea
                            ref={tekstInputRef}
                            value={tekstInput}
                            onChange={(e) => settTekstInput(e.target.value)}
                            onKeyDown={handterTastetrykk}
                            placeholder="Skriv en melding..."
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
        </div>
    );
} 
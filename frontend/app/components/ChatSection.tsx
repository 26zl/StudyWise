/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Sparkles } from "lucide-react";
import { useKITestConnection } from "../ki/ki-api";

// Meldings-typer
interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

// Placeholder
const suggestions = [
    "Hva er de viktigste fristene mine denne uken?",
    "Forklar konseptet fra siste forelesning",
    "Hjelp meg planlegge studieøkten min",
    "Vis meg kunngjøringer fra mine emner",
];
// ChatSection komponent
export function ChatSection() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // KI tilkoblingstest 
    const {
        refetch: testConnection,
        isLoading: isTestingConnection,
        data,
        error,
        isSuccess,
        isError
    } = useKITestConnection();

    // Auto-scroll 
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 150)}px`;
        }
    }, [input]);

    const handleSend = async () => {
        if (!input.trim() || isTyping) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsTyping(true);

        // Simulerer AI-respons (erstatt med ekte API-kall senere)
        setTimeout(() => {
            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content:
                    "Denne funksjonen er under utvikling. Snart vil du kunne stille sporsmal om dine Canvas-emner, frister og mer. Proov gjerne a teste tilkoblingen til AI-tjenesten!",
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, aiMessage]);
            setIsTyping(false);
        }, 1500);
    };
    // Handle Enter key for å sende melding
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };
    // Klikk på forslag for å fylle inn input
    const handleSuggestionClick = (suggestion: string) => {
        setInput(suggestion);
        inputRef.current?.focus();
    };

    // Velkomstskjerm når ingen meldinger er sendt
    if (messages.length === 0) {
        return (
            <div className="flex flex-col h-full">
                {/* Velkomstinnhold */}
                <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8">
                    <div className="w-16 h-16 mb-6 rounded-2xl bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-slate-600 dark:text-slate-300" />
                    </div>

                    <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white mb-3 text-center">
                        Hei! Hvordan kan jeg hjelpe?
                    </h1>

                    <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8 text-sm md:text-base">
                        Jeg er din studieassistent. Still meg sporsmal om dine Canvas-emner,
                        frister, eller fa hjelp med studiene.
                    </p>

                    {/* Suggestions */}
                    <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-3">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => handleSuggestionClick(suggestion)}
                                className="p-4 text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-all text-sm text-slate-700 dark:text-slate-300"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>

                    {/* Test Connection Button */}
                    <div className="flex flex-col items-center gap-4 mt-8">
                        <button
                            onClick={() => testConnection()}
                            disabled={isTestingConnection}
                            className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex items-center gap-2"
                        >
                            {isTestingConnection ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Tester tilkobling...
                                </>
                            ) : (
                                "Test AI-tilkobling"
                            )}
                        </button>

                        {/* Feedback Messages */}
                        {isSuccess && data && (
                            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400 text-center max-w-md">
                                <p className="font-medium">Tilkobling vellykket!</p>
                            </div>
                        )}

                        {isError && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400 text-center max-w-md">
                                <p className="font-medium">Kunne ikke koble til AI-tjenesten</p>
                                <p className="mt-1 opacity-90">
                                    {(error as Error)?.message || "En ukjent feil oppstod"}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Area */}
                <div className="p-4 md:p-6 border-t border-slate-200 dark:border-slate-800">
                    <div className="max-w-3xl mx-auto">
                        <div className="relative flex items-end gap-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Skriv en melding..."
                                rows={1}
                                className="flex-1 bg-transparent resize-none text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none text-sm md:text-base py-1.5"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isTyping}
                                className="shrink-0 p-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Send melding"
                            >
                                <Send size={18} />
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 text-center">
                            KI-assistenten kan gjøre feil. Dobbeltsjekk viktig informasjon.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Chat with messages
    return (
        <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
                    {messages.map((message) => (
                        <div key={message.id} className="flex gap-4">
                            {/* Avatar */}
                            <div
                                className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${message.role === "assistant"
                                    ? "bg-slate-100 dark:bg-slate-800"
                                    : "bg-slate-900 dark:bg-white"
                                    }`}
                            >
                                {message.role === "assistant" ? (
                                    <Bot
                                        size={18}
                                        className="text-slate-600 dark:text-slate-300"
                                    />
                                ) : (
                                    <User
                                        size={18}
                                        className="text-white dark:text-slate-900"
                                    />
                                )}
                            </div>

                            {/* Message Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-sm text-slate-900 dark:text-white">
                                        {message.role === "assistant" ? "StudyWise" : "Du"}
                                    </span>
                                    <span className="text-xs text-slate-400 dark:text-slate-500">
                                        {message.timestamp.toLocaleTimeString("nb-NO", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                </div>
                                <div className="text-slate-700 dark:text-slate-300 text-sm md:text-base leading-relaxed whitespace-pre-wrap">
                                    {message.content}
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Typing Indicator */}
                    {isTyping && (
                        <div className="flex gap-4">
                            <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                <Bot
                                    size={18}
                                    className="text-slate-600 dark:text-slate-300"
                                />
                            </div>
                            <div className="flex items-center gap-1.5 py-3">
                                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="max-w-3xl mx-auto">
                    <div className="relative flex items-end gap-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Skriv en melding..."
                            rows={1}
                            className="flex-1 bg-transparent resize-none text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none text-sm md:text-base py-1.5"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className="shrink-0 p-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            aria-label="Send melding"
                        >
                            {isTyping ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Send size={18} />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */ 
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, Paperclip, Download, Copy } from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { toast } from "sonner";
import { AttachmentStrip } from "./AttachmentStrip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { SmartSuggestions } from "./SmartSuggestions";
import { useKITestTilkobling, useKIChat, useKIDocumentAnalyse, SUPPORTED_FILE_TYPES } from "../ki/ki-api";
import { useChatHistory } from "../hooks/useChatHistory";
import { useUIStore } from "../store/uiStore";
import { exportToMarkdown } from "../utils/exportChat";
import { formaterKlokkeslett } from "../lib/dato";

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

// Hovedkomponent
export function ChatSection() {
    const [mounted, setMounted] = useState(false);
    const [meldinger, settMeldinger] = useState<Melding[]>([]);
    const [tekstInput, settTekstInput] = useState("");
    const [skriver, settSkriver] = useState(false);
    const [vedlegg, settVedlegg] = useState<File[]>([]);
    const [analyserarDokument, settAnalysererDokument] = useState(false);
    const [aktivChatId, setAktivChatId] = useState<string | null>(null);
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);
    const filInputRef = useRef<HTMLInputElement>(null);
    const oppretterChatRef = useRef(false);
    const { selectedChatId, setSelectedChatId, newChatToken, canvasContext, canvasContextSelection } = useUIStore();

    // Sjekk om brukeren har valgt minst ett Canvas-datasett (uavhengig av om data er lastet)
    const harValgtCanvasData = canvasContextSelection.announcements ||
        canvasContextSelection.courses ||
        canvasContextSelection.assignments ||
        canvasContextSelection.events;
    const sisteNySamtaleToken = useRef(newChatToken);

    // Sett mounted etter første render for å unngå hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    // KI tilkoblingstest 
    const {
        isError: erTilkoblingsFeil
    } = useKITestTilkobling();

    // KI chat hook
    const { sendMelding: sendTilAPI } = useKIChat();

    // Dokumentanalyse hook
    const { analyserDokument } = useKIDocumentAnalyse();

    // Chat history hook (lagret i DB, kryptert i backend)
    const { saveChat, loadChat: loadChatById, loading } = useChatHistory();

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

    // Lagre samtale (ny eller eksisterende)
    const lagreSamtale = async (oppdatert: Melding[]) => {
        const payload = oppdatert.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        if (aktivChatId) {
            await saveChat(payload, aktivChatId);
            return;
        }
        if (oppretterChatRef.current) return;
        oppretterChatRef.current = true;
        try {
            const nyId = await saveChat(payload);
            if (nyId) setAktivChatId(nyId);
        } finally {
            oppretterChatRef.current = false;
        }
    };

    // Ny samtale
    const nySamtale = async () => {
        if (meldinger.length > 0) {
            void lagreSamtale(meldinger);
        }
        settMeldinger([]);
        setAktivChatId(null);
        settVedlegg([]);
    };

    // Start ny samtale fra globale triggers (f.eks. sidebar)
    useEffect(() => {
        if (sisteNySamtaleToken.current === newChatToken) return;
        sisteNySamtaleToken.current = newChatToken;
        void nySamtale();
    }, [newChatToken]);

    // Håndter filer (gjenbrukbar for filvalg, innliming og dra-og-slipp)
    const håndterFiler = useCallback((filer: File[]) => {
        const godkjente: File[] = [];
        for (const fil of filer) {
            if (fil.size > 15 * 1024 * 1024) {
                const feilMelding: Melding = {
                    id: Date.now().toString(),
                    rolle: "assistant",
                    innhold: `Filen «${fil.name}» er for stor. Maksimal filstørrelse er 15 MB.`,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, feilMelding]);
            } else {
                godkjente.push(fil);
            }
        }
        if (godkjente.length > 0) {
            settVedlegg((prev) => [...prev, ...godkjente]);
        }
    }, []);

    // Håndter filvalg fra input-element (støtter multiple)
    const handleFilValg = (e: React.ChangeEvent<HTMLInputElement>) => {
        const filer = e.target.files;
        if (filer && filer.length > 0) {
            håndterFiler(Array.from(filer));
        }
        // Reset input slik at samme fil kan velges igjen
        if (filInputRef.current) {
            filInputRef.current.value = "";
        }
    };

    // Lim-inn håndtering (Ctrl+V) – fanger bilder fra utklippstavlen
    useEffect(() => {
        const textarea = tekstInputRef.current;
        if (!textarea) return;

        const onPaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            const bildeFiler: File[] = [];
            let harTekst = false;

            for (const item of items) {
                if (item.type.startsWith("image/")) {
                    const fil = item.getAsFile();
                    if (fil) {
                        const ext = fil.type.split("/")[1] || "png";
                        const ts = new Date()
                            .toISOString()
                            .replace(/[:.]/g, "-");
                        bildeFiler.push(
                            new File(
                                [fil],
                                `innlimt-bilde-${ts}-${bildeFiler.length + 1}.${ext}`,
                                { type: fil.type },
                            ),
                        );
                    }
                } else if (item.type === "text/plain") {
                    harTekst = true;
                }
            }

            if (bildeFiler.length > 0) {
                håndterFiler(bildeFiler);
                // Hvis utklippstavlen kun har bilder (skjermbilde etc.),
                // forhindre at nettleseren limer inn ubrukelig data.
                // Har den også tekst (f.eks. kopiert fra Word), la teksten passere.
                if (!harTekst) {
                    e.preventDefault();
                }
            }
        };

        textarea.addEventListener("paste", onPaste);
        return () => textarea.removeEventListener("paste", onPaste);
    }, [håndterFiler]);

    // Fjern ett vedlegg fra listen
    const fjernVedlegg = useCallback((index: number) => {
        settVedlegg((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Send melding
    const sendMelding = async () => {
        const harVedlegg = vedlegg.length > 0;
        if ((!tekstInput.trim() && !harVedlegg) || skriver || analyserarDokument) return;

        const vedlagtNavn = vedlegg.map((f) => f.name).join(", ");
        const brukerMeldingInnhold = tekstInput.trim() || (harVedlegg ? `Analyser dokumentet: ${vedlagtNavn}` : "");
        settTekstInput("");

        // Reset høyde
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
        }

        // Legg til brukerens melding
        const brukerMelding: Melding = {
            id: Date.now().toString(),
            rolle: "user",
            innhold: harVedlegg
                ? `${brukerMeldingInnhold}\n\n[Vedlagt: ${vedlagtNavn}]`
                : brukerMeldingInnhold,
            tidsstempel: new Date(),
        };

        settMeldinger((tidligere) => [...tidligere, brukerMelding]);

        // Hvis det er vedlegg, bruk dokumentanalyse (én fil om gangen)
        // NB: Backend-API-et aksepterer kun én fil per forespørsel.
        // Vi sender den første filen; ønsker man batch-analyse må backend utvides.
        if (harVedlegg) {
            settAnalysererDokument(true);
            const filTilAnalyse = vedlegg[0];
            settVedlegg([]);

            analyserDokument(filTilAnalyse, brukerMeldingInnhold || "Gi meg en oppsummering av dette dokumentet.", {
                onSuccess: (data) => {
                    const aiMelding: Melding = {
                        id: (Date.now() + 1).toString(),
                        rolle: "assistant",
                        innhold: data.dokumentInfo 
                            ? `${data.response}\n\n---\n_Dokument: ${data.dokumentInfo.sider} sider, ${data.dokumentInfo.tegn.toLocaleString("nb-NO")} tegn${data.dokumentInfo.truncated ? " (forkortet)" : ""}_`
                            : data.response,
                        tidsstempel: new Date(),
                    };
                    settMeldinger((tidligere) => {
                        const oppdatert = [...tidligere, aiMelding];
                        lagreSamtale(oppdatert).catch((err) => {
                            console.error("Feil ved lagring av samtale:", err);
                        });
                        return oppdatert;
                    });
                    settAnalysererDokument(false);
                },
                onError: (error) => {
                    // Lag brukervennlig feilmelding for dokumentanalyse
                    let feilTekst: string;
                    if (error.message.includes("for stor") || error.message.includes("413")) {
                        feilTekst = "Filen er for stor. Maksimal filstørrelse er 15MB.";
                    } else if (error.message.includes("429") || error.message.includes("rate")) {
                        feilTekst = "For mange forespørsler. Vent noen sekunder og prøv igjen.";
                    } else if (error.message.includes("timeout") || error.message.includes("504")) {
                        feilTekst = "Analysen tok for lang tid. Prøv med et mindre dokument.";
                    } else if (error.message.includes("utilgjengelig") || error.message.includes("503")) {
                        feilTekst = "Dokumentanalyse er midlertidig utilgjengelig. Prøv igjen om noen minutter.";
                    } else if (error.message.includes("filtype") || error.message.includes("støttes ikke")) {
                        feilTekst = "Filtypen støttes ikke. Prøv PDF, Word, eller tekstfiler.";
                    } else {
                        feilTekst = error.message || "Kunne ikke analysere dokumentet. Prøv igjen.";
                    }
                    toast.error("Dokumentanalyse feilet", { description: feilTekst });
                    const feilMelding: Melding = {
                        id: (Date.now() + 1).toString(),
                        rolle: "assistant",
                        innhold: feilTekst,
                        tidsstempel: new Date(),
                    };
                    settMeldinger((tidligere) => {
                        const oppdatert = [...tidligere, feilMelding];
                        // Lagre samtale selv ved feil
                        lagreSamtale(oppdatert).catch((err) => {
                            console.error("Feil ved lagring av samtale:", err);
                        });
                        return oppdatert;
                    });
                    settAnalysererDokument(false);
                },
            });
            return;
        }

        // Vanlig chat uten fil
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

        // Detektér hvilken type Canvas-data brukeren spør om
        const spørOmKunngjøringer = /kunngjør|announcement|beskjed|melding fra foreleser/i.test(brukerMeldingInnhold);
        const spørOmEmner = /emne|course|fag|kurs(?!gjøring)/i.test(brukerMeldingInnhold);
        const spørOmOppgaver = /oppgave|assignment|innlevering|frist|deadline|todo|gjøremål/i.test(brukerMeldingInnhold);
        const spørOmHendelser = /hendelse|event|kalender|møte|forelesning/i.test(brukerMeldingInnhold);
        const spørOmCanvas = spørOmKunngjøringer || spørOmEmner || spørOmOppgaver || spørOmHendelser || 
            /canvas|data|mine|hva har jeg/i.test(brukerMeldingInnhold);

        // Sjekk om bruker spør om noe som ikke er valgt i innstillinger
        if (spørOmCanvas) {
            const manglerData: string[] = [];

            // Sjekk mot brukerens valg (canvasContextSelection), ikke kontekst-strengen
            if (spørOmKunngjøringer && !canvasContextSelection.announcements) {
                manglerData.push("Kunngjøringer");
            }
            if (spørOmEmner && !canvasContextSelection.courses) {
                manglerData.push("Emner");
            }
            if (spørOmOppgaver && !canvasContextSelection.assignments) {
                manglerData.push("Oppgaver");
            }
            if (spørOmHendelser && !canvasContextSelection.events) {
                manglerData.push("Hendelser");
            }

            // Hvis brukeren ikke har valgt noen Canvas-data i innstillinger
            if (!harValgtCanvasData) {
                const systemMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: "Du har ikke valgt noen Canvas-data. Gå til Innstillinger → AI Canvas-kontekst og velg minst ett datasett for at jeg skal kunne hjelpe deg med Canvas-relaterte spørsmål.",
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, systemMelding]);
                settSkriver(false);
                return;
            }
            
            // Hvis brukeren spør om noe spesifikt som ikke er valgt - STOPP
            if (manglerData.length > 0) {
                const systemMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: `Jeg har ikke tilgang til ${manglerData.join(" eller ").toLowerCase()} fordi dette ikke er aktivert.\n\nGå til Innstillinger → AI Canvas-kontekst og aktiver «${manglerData.join("» og «")}», og prøv igjen.`,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, systemMelding]);
                settSkriver(false);
                return;
            }
        }

        // Send til ekte API
        sendTilAPI(apiMeldinger, {
            onSuccess: (data) => {
                const aiMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: data.response,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => {
                    const oppdatert = [...tidligere, aiMelding];
                    // Auto-save hele samtalen til historikk (vent på at chat blir opprettet)
                    lagreSamtale(oppdatert).catch((err) => {
                        console.error("Feil ved lagring av samtale:", err);
                    });
                    return oppdatert;
                });
                settSkriver(false);
            },
            onError: (error) => {
                let feilTekst: string;
                const errorName = error.name;
                if (errorName === "KIRateLimitError") {
                    feilTekst = "For mange forespørsler. Vent noen sekunder og prøv igjen.";
                } else if (errorName === "KIServiceError") {
                    feilTekst = "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.";
                } else if (errorName === "KITimeoutError") {
                    feilTekst = "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet ditt.";
                } else if (errorName === "KIAuthError") {
                    feilTekst = "Du må logge inn på nytt for å bruke KI-assistenten.";
                } else if (error.message.includes("timeout") || error.message.includes("504")) {
                    feilTekst = "Forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet.";
                } else if (error.message.includes("429") || error.message.includes("rate")) {
                    feilTekst = "For mange forespørsler. Vent litt og prøv igjen.";
                } else {
                    feilTekst = error.message || "Noe gikk galt. Prøv igjen.";
                }
                toast.error("KI-svar feilet", { description: feilTekst });
                const feilMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: feilTekst,
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => {
                    const oppdatert = [...tidligere, feilMelding];
                    // Lagre samtale selv ved feil
                    lagreSamtale(oppdatert).catch((err) => {
                        console.error("Feil ved lagring av samtale:", err);
                    });
                    return oppdatert;
                });
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

    // Last chat valgt fra sidebar
    useEffect(() => {
        if (!selectedChatId) return;
        const chat = loadChatById(selectedChatId);
        if (chat) {
            settMeldinger(
                chat.messages.map((m, i) => ({
                    id: `${Date.now()}-${i}`,
                    rolle: m.rolle,
                    innhold: m.innhold,
                    tidsstempel: new Date(),
                }))
            );
            setAktivChatId(chat.id);
        }
        setSelectedChatId(null);
    }, [selectedChatId, loadChatById, setSelectedChatId]);

    return (
        <div className="h-full flex">
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center">
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
                </div>

                {/* Meldinger */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                    {/* Tilkoblingsfeil */}
                    {erTilkoblingsFeil && (
                        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                            <p className="text-sm text-red-700 dark:text-red-300">
                                Kunne ikke koble til KI-assistenten. Prøv igjen senere.
                            </p>
                        </div>
                    )}

                    {/* Placeholder før hydration - matcher server-rendering */}
                    {!mounted && (
                        <div className="flex justify-center items-center py-12">
                            <LoadingSpinner />
                        </div>
                    )}

                    {/* Loading state - vis kun etter mount for å unngå hydration mismatch */}
                    {mounted && loading && (
                        <div className="flex justify-center items-center py-12">
                            <LoadingSpinner />
                            <p className="ml-3 text-sm text-slate-500">Laster samtalehistorikk...</p>
                        </div>
                    )}

                    {/* Tomme meldinger - vis forslag (kun etter mount og når ikke loading) */}
                    {mounted && !loading && meldinger.length === 0 && (
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
                                <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
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
                                {melding.rolle === "assistant" ? (
                                    <>
                                        <div className="text-sm prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-blue-600 dark:prose-code:text-blue-400 prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none max-w-none">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeSanitize]}
                                            >
                                                {melding.innhold}
                                            </ReactMarkdown>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-2">
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {formaterKlokkeslett(melding.tidsstempel)}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(melding.innhold);
                                                        toast.success("Kopiert til utklippstavle");
                                                    } catch {
                                                        toast.error("Kunne ikke kopiere");
                                                    }
                                                }}
                                                className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                                title="Kopier hele svaret"
                                            >
                                                <Copy className="w-3.5 h-3.5 shrink-0" />
                                                Kopier
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm whitespace-pre-wrap">{melding.innhold}</p>
                                        <p className="text-xs mt-1 text-blue-100">
                                            {formaterKlokkeslett(melding.tidsstempel)}
                                        </p>
                                    </>
                                )}
                            </div>

                            {melding.rolle === "user" && (
                                <div className="w-8 h-8 rounded-full bg-slate-700 dark:bg-slate-600 flex items-center justify-center shrink-0">
                                    <User className="w-4 h-4 text-white" />
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Skriver indikator */}
                    {(skriver || analyserarDokument) && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4 text-white" />
                            </div>
                            <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3">
                                {analyserarDokument ? (
                                    <div className="flex items-center gap-2">
                                        <LoadingSpinner className="w-4 h-4" />
                                        <span className="text-sm text-slate-500 dark:text-slate-400">Analyserer dokument...</span>
                                    </div>
                                ) : (
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                                        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                                        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div ref={meldingerSluttRef} />
                </div>

                {/* Smart suggestions - VIS KUN NÅR DET ER MELDINGER OG IKKE SKRIVER */}
                {meldinger.length > 0 && !skriver && !analyserarDokument && (
                    <SmartSuggestions
                        lastAIMessage={meldinger[meldinger.length - 1]?.innhold || ""}
                        onSelectSuggestion={(suggestion) => {
                            settTekstInput(suggestion);
                            tekstInputRef.current?.focus();
                        }}
                        disabled={skriver || analyserarDokument}
                    />
                )}

                {/* Input */}
                <div className="shrink-0 p-4 md:p-6 border-t border-slate-200 dark:border-slate-800">
                    {/* Vedleggsliste (kompakt stripe) */}
                    <AttachmentStrip vedlegg={vedlegg} onFjern={fjernVedlegg} />
                    
                    <div className="flex gap-3">
                        {/* Skjult fil-input */}
                        <input
                            ref={filInputRef}
                            type="file"
                            accept={SUPPORTED_FILE_TYPES.join(",")}
                            onChange={handleFilValg}
                            multiple
                            className="hidden"
                        />
                        
                        {/* Eksporter samtale */}
                        <button
                            onClick={() => {
                                exportToMarkdown(meldinger);
                                toast.success("Samtale eksportert", { description: "Filen lastes ned." });
                            }}
                            disabled={meldinger.length === 0}
                            className="shrink-0 w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Eksporter samtale til Markdown"
                            aria-label="Eksporter samtale"
                        >
                            <Download className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        </button>

                        {/* Filopplastingsknapp */}
                        <button
                            onClick={() => filInputRef.current?.click()}
                            disabled={skriver || analyserarDokument}
                            className="shrink-0 w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Last opp dokument (PDF, Word, TXT)"
                            aria-label="Last opp dokument"
                        >
                            <Paperclip className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        </button>
                        
                        <textarea
                            ref={tekstInputRef}
                            value={tekstInput}
                            onChange={(e) => settTekstInput(e.target.value)}
                            onKeyDown={handterTastetrykk}
                            placeholder={vedlegg.length > 0 ? "Skriv et spørsmål om vedlegget..." : "Skriv en melding..."}
                            disabled={skriver || analyserarDokument}
                            rows={1}
                            className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ maxHeight: "150px" }}
                        />
                        <button
                            onClick={sendMelding}
                            disabled={(!tekstInput.trim() && vedlegg.length === 0) || skriver || analyserarDokument}
                            className="shrink-0 w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            aria-label={skriver || analyserarDokument ? "Sender melding" : "Send melding"}
                        >
                            {skriver || analyserarDokument ? (
                                <LoadingSpinner className="w-5 h-5 text-white animate-spin" />
                            ) : (
                                <Send className="w-5 h-5 text-white" />
                            )}
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Trykk Enter for å sende, Shift+Enter for ny linje. Støtter PDF, Word, bilder og mer. Lim inn bilder med Ctrl+V.
                    </p>
                </div>
            </div>
        </div>
    );
}   
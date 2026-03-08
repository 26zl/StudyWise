/*
 * ChatSection - KI chat grensesnitt
 * Hovedområdet for samtaler med AI-assistenten
 */ 
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Download, Copy, Share2, RefreshCw, ThumbsUp, ThumbsDown, MoreHorizontal, Plus, Image, FileText, User } from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { toast } from "sonner";
import { AttachmentStrip } from "./AttachmentStrip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { SmartSuggestions } from "./SmartSuggestions";
import { useKIChat, useKIDocumentAnalyse, useKITestTilkobling, SUPPORTED_FILE_TYPES } from "../ki/ki-api";
import { useChatHistory } from "../hooks/useChatHistory";
import { FeilMelding } from "./FeilMelding";
import { useUIStore } from "../store/uiStore";
import { exportToMarkdown } from "../utils/exportChat";

// Meldings-typer
interface Melding {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: Date;
    vedleggNavn?: string[];
}

// Forslag til spørsmål
const forslag = [
    "Hva er de viktigste fristene mine denne uken?",
    "Forklar konseptet fra siste forelesning",
    "Hjelp meg planlegge studieøkten min",
    "Vis meg kunngjøringer fra mine emner",
];

/** Parse vedlegg-info fra meldingsinnhold og returner ren tekst + filnavn */
function parseVedlegg(innhold: string): { tekst: string; filer: string[] } {
    const vedleggMatch = innhold.match(/\n?\n?\[Vedlagt:\s*(.+?)\]\s*$/);
    if (!vedleggMatch) return { tekst: innhold, filer: [] };
    const tekst = innhold.slice(0, vedleggMatch.index).trim();
    const filnavn = vedleggMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    return { tekst, filer: filnavn };
}

function erBildefil(navn: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(navn);
}

/** Felles klassenavn for handlingsknapper under AI-svar */
const actionBtnClass = "p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md hover:bg-slate-100 dark:hover:bg-slate-800";

/** Lag brukervennlig feilmelding basert på error */
function lagFeilTekst(error: Error, kontekst: "chat" | "dokument"): string {
    const msg = error.message;
    const name = error.name;
    // Navngitte feilklasser (fra ki-api)
    if (name === "KIRateLimitError" || msg.includes("429") || msg.includes("rate")) {
        return "For mange forespørsler. Vent noen sekunder og prøv igjen.";
    }
    if (name === "KIServiceError" || msg.includes("utilgjengelig") || msg.includes("503")) {
        return kontekst === "dokument"
            ? "Dokumentanalyse er midlertidig utilgjengelig. Prøv igjen om noen minutter."
            : "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.";
    }
    if (name === "KITimeoutError" || msg.includes("timeout") || msg.includes("504")) {
        return kontekst === "dokument"
            ? "Analysen tok for lang tid. Prøv med et mindre dokument."
            : "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet ditt.";
    }
    if (name === "KIAuthError") {
        return "Du må logge inn på nytt for å bruke KI-assistenten.";
    }
    // Generelle HTTP-feil
    if (msg.includes("for stor") || msg.includes("413")) {
        return "Filen er for stor. Maksimal filstørrelse er 15MB.";
    }
    if (msg.includes("filtype") || msg.includes("støttes ikke")) {
        return "Filtypen støttes ikke. Prøv PDF, Word, eller tekstfiler.";
    }
    if (msg.includes("Internal Server Error") || msg.includes("500") || msg.includes("Server Error") || msg.includes("serveren")) {
        return "Noe gikk galt på serveren. Prøv igjen om litt, eller forenkle spørsmålet ditt.";
    }
    return msg || (kontekst === "dokument" ? "Kunne ikke analysere dokumentet. Prøv igjen." : "Noe gikk galt. Prøv igjen.");
}

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
    const meldingerRef = useRef<Melding[]>([]);
    const oppretterChatRef = useRef(false);
    const isMountedRef = useRef(true);
    /** Kontekst for pågående KI-forespørsel – brukes i onSuccess/onError så vi kan lagre riktig chat selv om brukeren har forlatt */
    const pendingChatRef = useRef<{
        chatId: string | null;
        messagesBefore: Melding[];
        userMessage: Melding;
        visibleMessageIds: string[];
    } | null>(null);
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

    // Spor om komponenten er montert (for pågående forespørsler som fullfører etter navigering)
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // KI tilkoblingstest (viser feilmelding hvis KI er utilgjengelig)
    const { isError: erTilkoblingsFeil } = useKITestTilkobling(mounted);

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

    useEffect(() => {
        meldingerRef.current = meldinger;
    }, [meldinger]);

    // Auto-resize textarea
    useEffect(() => {
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
            tekstInputRef.current.style.height = `${tekstInputRef.current.scrollHeight}px`;
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

    const kanOppdatereSynligSamtale = (pending: NonNullable<typeof pendingChatRef.current>) => {
        const currentIds = meldingerRef.current.map((m) => m.id);
        return (
            currentIds.length === pending.visibleMessageIds.length &&
            currentIds.every((id, index) => id === pending.visibleMessageIds[index])
        );
    };

    const persistPendingConversation = async (
        pending: NonNullable<typeof pendingChatRef.current>,
        sisteMelding: Melding,
    ) => {
        const payload = [...pending.messagesBefore, pending.userMessage, sisteMelding].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        const savedChatId = await saveChat(payload, pending.chatId ?? undefined);
        if (
            savedChatId &&
            !pending.chatId &&
            isMountedRef.current &&
            kanOppdatereSynligSamtale(pending)
        ) {
            setAktivChatId(savedChatId);
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
        if (filer.length === 0) return;

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

        if (godkjente.length === 0) return;

        if (vedlegg.length > 0 || godkjente.length > 1) {
            toast.info("Kun ett vedlegg om gangen", {
                description: "Jeg bruker bare det første vedlegget.",
            });
        }

        settVedlegg([godkjente[0]]);
    }, [vedlegg.length]);

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
            innhold: brukerMeldingInnhold,
            tidsstempel: new Date(),
            vedleggNavn: harVedlegg ? vedlegg.map((f) => f.name) : undefined,
        };

        settMeldinger((tidligere) => [...tidligere, brukerMelding]);
        meldingerRef.current = [...meldinger, brukerMelding];

        // Hvis det er vedlegg, bruk dokumentanalyse.
        // UI-en tillater kun én fil om gangen for å matche backend-endepunktet.
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
                        lagreSamtale(oppdatert).catch(() => {
                            toast.error("Kunne ikke lagre samtalen", { description: "Prøv igjen senere." });
                        });
                        return oppdatert;
                    });
                    settAnalysererDokument(false);
                },
                onError: (error) => {
                    const feilTekst = lagFeilTekst(error, "dokument");
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
                        lagreSamtale(oppdatert).catch(() => {
                            toast.error("Kunne ikke lagre samtalen", { description: "Prøv igjen senere." });
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

        // Lagre kontekst for denne forespørselen så vi kan lagre riktig chat selv om brukeren forlater siden
        pendingChatRef.current = {
            chatId: aktivChatId,
            messagesBefore: [...meldinger],
            userMessage: brukerMelding,
            visibleMessageIds: [...meldinger, brukerMelding].map((m) => m.id),
        };

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

        // Send til ekte API (fullfører i bakgrunnen selv om brukeren forlater chatten)
        sendTilAPI(apiMeldinger, {
            onSuccess: (data) => {
                const aiMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: data.response,
                    tidsstempel: new Date(),
                };
                const pending = pendingChatRef.current;
                pendingChatRef.current = null;
                const skalOppdatereSynlig = pending ? kanOppdatereSynligSamtale(pending) : false;
                if (pending) {
                    void persistPendingConversation(pending, aiMelding);
                }
                if (isMountedRef.current) {
                    if (skalOppdatereSynlig) {
                        settMeldinger((tidligere) => [...tidligere, aiMelding]);
                    }
                    settSkriver(false);
                }
            },
            onError: (error) => {
                const feilTekst = lagFeilTekst(error, "chat");
                toast.error("KI-svar feilet", { description: feilTekst });
                const feilMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: feilTekst,
                    tidsstempel: new Date(),
                };
                const pending = pendingChatRef.current;
                pendingChatRef.current = null;
                const skalOppdatereSynlig = pending ? kanOppdatereSynligSamtale(pending) : false;
                if (pending) {
                    void persistPendingConversation(pending, feilMelding);
                }
                if (isMountedRef.current) {
                    if (skalOppdatereSynlig) {
                        settMeldinger((tidligere) => [...tidligere, feilMelding]);
                    }
                    settSkriver(false);
                }
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

    // Last chat valgt fra sidebar (sjekk isMountedRef for å unngå setState etter unmount)
    // Nullstill selectedChatId kun når chat er lastet, slik at valget beholdes hvis chats ennå ikke er hentet
    useEffect(() => {
        if (!selectedChatId) return;
        const chat = loadChatById(selectedChatId);
        if (chat && isMountedRef.current) {
            settMeldinger(
                chat.messages.map((m, i) => ({
                    id: `${Date.now()}-${i}`,
                    rolle: m.rolle,
                    innhold: m.innhold,
                    tidsstempel: new Date(),
                }))
            );
            setAktivChatId(chat.id);
            setSelectedChatId(null);
            return;
        }

        if (!loading) {
            setSelectedChatId(null);
        }
    }, [selectedChatId, loadChatById, setSelectedChatId, loading]);

    return (
        <div className="h-full flex">
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Meldinger */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                  <div className="max-w-[940px] mx-auto space-y-5">
                    {/* Tilkoblingsfeil – bruk felles FeilMelding */}
                    {erTilkoblingsFeil && (
                        <FeilMelding melding="Kunne ikke koble til KI-assistenten. Prøv igjen senere." />
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
                            <p className="ml-3 text-sm text-slate-500 dark:text-slate-400">Laster samtalehistorikk...</p>
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
                            className={`flex items-start gap-3 ${melding.rolle === "user" ? "justify-end" : "justify-start"}`}
                        >
                            {/* AI-avatar (venstre) */}
                            {melding.rolle === "assistant" && (
                                <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                                    <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                </div>
                            )}
                            <div className={melding.rolle === "user" ? "max-w-[80%]" : "w-full min-w-0"}>
                                <div
                                    className={
                                        melding.rolle === "user"
                                            ? "rounded-2xl px-5 py-3.5 bg-stone-100 dark:bg-slate-700 text-slate-900 dark:text-white"
                                            : "text-slate-900 dark:text-white"
                                    }
                                >
                                    {melding.rolle === "assistant" ? (
                                        <div className="prose prose-base dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-3 prose-code:text-blue-600 dark:prose-code:text-blue-400 prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none max-w-none">
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeSanitize]}
                                            >
                                                {melding.innhold}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <>
                                            {(() => {
                                                const alleFiler = melding.vedleggNavn ?? parseVedlegg(melding.innhold).filer;
                                                const renTekst = melding.vedleggNavn ? melding.innhold : parseVedlegg(melding.innhold).tekst;
                                                return (
                                                    <>
                                                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{renTekst}</p>
                                                        {alleFiler.length > 0 && (
                                                            <div className="flex flex-wrap gap-2 mt-2.5">
                                                                {alleFiler.map((navn, i) => (
                                                                    <span
                                                                        key={i}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 dark:bg-slate-600/50 text-xs text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-600"
                                                                    >
                                                                        {erBildefil(navn) ? <Image className="w-3.5 h-3.5 text-slate-400" /> : <FileText className="w-3.5 h-3.5 text-slate-400" />}
                                                                        {navn}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </>
                                    )}
                                </div>

                                {/* Handlingsknapper under AI-svar */}
                                {melding.rolle === "assistant" && (
                                    <div className="flex items-center justify-between mt-1.5 px-0.5">
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                type="button"
                                                onClick={() => toast.info("Del-funksjon kommer snart")}
                                                className={actionBtnClass}
                                                title="Del"
                                            >
                                                <Share2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    exportToMarkdown(
                                                        [{
                                                            rolle: melding.rolle,
                                                            innhold: melding.innhold,
                                                            tidsstempel: melding.tidsstempel,
                                                        }],
                                                        "AI-svar",
                                                        "studywise-svar",
                                                    );
                                                    toast.success("Svar lastet ned");
                                                }}
                                                className={actionBtnClass}
                                                title="Last ned svar"
                                            >
                                                <Download className="w-4 h-4" />
                                            </button>
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
                                                className={actionBtnClass}
                                                title="Kopier"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => toast.info("Regenerer-funksjon kommer snart")}
                                                className={actionBtnClass}
                                                title="Regenerer svar"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                type="button"
                                                onClick={() => toast.success("Positiv tilbakemelding registrert")}
                                                className={actionBtnClass}
                                                title="Bra svar"
                                            >
                                                <ThumbsUp className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => toast.success("Negativ tilbakemelding registrert")}
                                                className={actionBtnClass}
                                                title="Dårlig svar"
                                            >
                                                <ThumbsDown className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => toast.info("Flere valg kommer snart")}
                                                className={actionBtnClass}
                                                title="Flere valg"
                                            >
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Bruker-avatar (høyre) */}
                            {melding.rolle === "user" && (
                                <div className="shrink-0 w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center mt-1">
                                    <User className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Skriver indikator */}
                    {(skriver || analyserarDokument) && (
                        <div className="flex items-start gap-3 justify-start">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                                <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="py-3">
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
                <div className="shrink-0 px-4 md:px-6 pb-4 pt-3">
                  <div className="max-w-[940px] mx-auto">
                    {/* Vedleggsliste (kompakt stripe) */}
                    <AttachmentStrip vedlegg={vedlegg} onFjern={fjernVedlegg} />
                    
                    <div className="flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus-within:border-slate-200 dark:focus-within:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 focus-within:outline-none focus-within:ring-0">
                        {/* Skjult fil-input - én fil om gangen for å matche backend */}
                        <input
                            ref={filInputRef}
                            type="file"
                            accept={SUPPORTED_FILE_TYPES.join(",")}
                            onChange={handleFilValg}
                            className="hidden"
                        />
                        
                        {/* Filopplasting */}
                        <button
                            onClick={() => filInputRef.current?.click()}
                            disabled={skriver || analyserarDokument}
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Last opp dokument (PDF, Word, TXT)"
                            aria-label="Last opp dokument"
                        >
                            <Plus className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>
                        
                        <textarea
                            ref={tekstInputRef}
                            value={tekstInput}
                            onChange={(e) => settTekstInput(e.target.value)}
                            onKeyDown={handterTastetrykk}
                            placeholder={vedlegg.length > 0 ? "Skriv et spørsmål om vedlegget..." : "Skriv en melding..."}
                            disabled={skriver || analyserarDokument}
                            rows={1}
                            className="flex-1 resize-none bg-transparent py-2 text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 border-none shadow-none disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                            style={{ outline: "none" }}
                        />
                        <button
                            onClick={sendMelding}
                            disabled={(!tekstInput.trim() && vedlegg.length === 0) || skriver || analyserarDokument}
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            aria-label={skriver || analyserarDokument ? "Sender melding" : "Send melding"}
                        >
                            {skriver || analyserarDokument ? (
                                <LoadingSpinner className="w-4 h-4 text-slate-400 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                            )}
                        </button>
                    </div>
                    <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-2">
                        Trykk Enter for å sende · Shift+Enter for ny linje
                    </p>
                  </div>
                </div>
            </div>
        </div>
    );
}   

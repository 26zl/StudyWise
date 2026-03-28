/*
 * ChatSection – KI-chatgrensesnitt (meldinger, input, vedlegg, dokumentanalyse).
 * Håndterer: vanlig chat, dokumentanalyse med vedlegg, lagring ved første melding,
 * pending state ved navigering, gjenåpning av siste chat (sessionStorage), og eksport til MD.
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Download, Copy, Share2, RefreshCw, Plus, User } from "lucide-react";
import { LoadingSpinner, LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { AttachmentStrip } from "@/app/components/chat/AttachmentStrip";
import { ChatShareModal } from "@/app/components/chat/ChatShareModal";
import { ConversationMessageContent } from "@/app/components/chat/ConversationMessageContent";
import { SmartSuggestions } from "@/app/components/chat/SmartSuggestions";
import { ChatShareResponseSchema } from "common/chat";
import { streamKIChat, useKIDocumentAnalyse, SUPPORTED_FILE_TYPES, getKIErrorMessage, getKIBannerForError, type KIErrorContext } from "@/app/ki/ki-api";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { FeilMelding, type FeilMeldingType } from "@/app/components/ui/FeilMelding";
import { useUIStore } from "@/app/store/uiStore";
import { useKIStore } from "@/app/store/kiStore";
import { exportToMarkdown } from "@/app/utils/exportChat";
import { fetchApi } from "@/app/lib/apiClient";
import { formaterTall } from "@/app/lib/dato";
import { parseApiError } from "@/app/lib/errorUtils";

/** Én melding i chatten (bruker eller assistent), med id og evt. vedleggsnavn. */
interface Melding {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: Date;
    vedleggNavn?: string[];
    /** Markerer at KI-svaret feilet for denne brukerforespørselen */
    feilet?: boolean;
}

/** Forslag som vises når chatten er tom. */
const forslag = [
    "Hvilke oppgaver og frister bør jeg prioritere denne uken?",
    "Hvilke emner er jeg registrert på akkurat nå?",
    "Oppsummer nye kunngjøringer og viktige endringer fra emnene mine",
    "Forklar det viktigste fra siste modul eller forelesning i et av emnene mine",
];

/** Serialisert melding (tidsstempel som ISO-streng) for lagring i modulstate. */
type PendingMeldingSnapshot = {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: string;
    vedleggNavn?: string[];
};

/** Pågående forespørsel som kan gjenopptas etter refresh/navigering (chat eller dokumentanalyse). */
type PendingConversationState = {
    requestId: string;
    chatId: string | null;
    title: string;
    messagesBefore: PendingMeldingSnapshot[];
    userMessage: PendingMeldingSnapshot;
    assistantMessage?: PendingMeldingSnapshot;
    mode: "chat" | "document";
    status: "pending" | "failed";
    isResponsePending: boolean;
};

type SendMeldingOptions = {
    forcedText?: string;
    skipCanvasValidation?: boolean;
};

/** Modul-nivå state for å overleve unmount (f.eks. ved refresh under pågående svar). */
let pendingConversationState: PendingConversationState | null = null;

function serializeMelding(melding: Melding): PendingMeldingSnapshot {
    return {
        id: melding.id,
        rolle: melding.rolle,
        innhold: melding.innhold,
        tidsstempel: melding.tidsstempel.toISOString(),
        vedleggNavn: melding.vedleggNavn,
    };
}

function hydrateMelding(snapshot: PendingMeldingSnapshot): Melding {
    return {
        id: snapshot.id,
        rolle: snapshot.rolle,
        innhold: snapshot.innhold,
        tidsstempel: new Date(snapshot.tidsstempel),
        vedleggNavn: snapshot.vedleggNavn,
    };
}

function createPendingRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


/** Bygger payload (rolle + innhold) for saveChat fra pending state. */
function buildPendingPayload(pending: PendingConversationState) {
    return [
        ...pending.messagesBefore,
        pending.userMessage,
        ...(pending.assistantMessage ? [pending.assistantMessage] : []),
    ].map((melding) => ({
        rolle: melding.rolle,
        innhold: melding.innhold,
    }));
}

/** Avleder skriver/analyserarDokument fra pending (brukes ved gjenopptak). */
function getPendingUiState(pending?: PendingConversationState | null) {
    if (!pending || pending.status !== "pending" || !pending.isResponsePending) {
        return { skriver: false, analysererDokument: false };
    }
    return {
        skriver: pending.mode === "chat",
        analysererDokument: pending.mode === "document",
    };
}

/** Felles klassenavn for handlingsknapper under AI-svar */
const actionBtnClass = "p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md hover:bg-slate-100 dark:hover:bg-slate-800";

/** Brukervennlig feilmelding for toast – delegerer til ki-api (én kilde for KI-feilklassifisering). */
function lagFeilTekst(error: Error, kontekst: KIErrorContext): string {
    return getKIErrorMessage(error, kontekst);
}

/** Banner for tilkoblingsfeil – delegerer til ki-api (én kilde for KI-feilklassifisering). */
function lagTilkoblingsBanner(error: Error | null | undefined): { melding: string; type: FeilMeldingType } | null {
    if (!error) return null;
    return getKIBannerForError(error);
}

export function ChatSection() {
    const { language, t } = useLanguage();
    const [mounted, setMounted] = useState(false);
    const [meldinger, settMeldinger] = useState<Melding[]>([]);
    const [tekstInput, settTekstInput] = useState("");
    const [skriver, settSkriver] = useState(false);
    const [vedlegg, settVedlegg] = useState<File[]>([]);
    const [analyserarDokument, settAnalysererDokument] = useState(false);
    const [aktivChatId, setAktivChatId] = useState<string | null>(null);
    const [animerendeMeldingId, settAnimerendeMeldingId] = useState<string | null>(null);
    const [viserShareModal, setViserShareModal] = useState(false);
    const [oppretterDeling, setOppretterDeling] = useState(false);
    /** KI-feil fra reelt kall (chat/dokumentanalyse) – vises som banner; erstatter tidligere test-connection. */
    const [kiError, settKiError] = useState<Error | null>(null);

    const meldingsContainerRef = useRef<HTMLDivElement>(null);
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);
    const filInputRef = useRef<HTMLInputElement>(null);
    const sendMeldingRef = useRef<(options?: SendMeldingOptions) => Promise<void>>(async () => {});
    const meldingerRef = useRef<Melding[]>([]);
    const oppretterChatRef = useRef(false);
    const isMountedRef = useRef(true);
    const retriedPendingSaveRef = useRef<string | null>(null);
    const brukerErVedBunnRef = useRef(true);
    /** Ref for animasjonsintervall — ryddes opp ved unmount eller ny melding. */
    const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /** Pågående chat-forespørsel: brukes i onSuccess/onError for å lagre riktig chat (inkl. chatId fra promise) etter svar. */
    const pendingChatRef = useRef<{
        requestId: string;
        chatId: string | null;
        chatIdPromise: Promise<string | undefined>;
        title: string;
        messagesBefore: Melding[];
        userMessage: Melding;
    } | null>(null);
    /** Chat-id for pågående dokumentanalyse; brukes i onSuccess/onError for bakgrunnslagring uavhengig av mount. */
    const docAnalysisChatIdRef = useRef<string | null>(null);
    const {
        selectedChatId,
        setSelectedChatId,
        setCurrentChatId,
        newChatToken,
        pendingKIMelding,
        clearPendingKIMelding,
        canvasContextSelection,
    } = useUIStore();
    const { setRunningChatId } = useKIStore();

    /** Brukes for å vurdere om bruker spør om Canvas uten å ha valgt noe i innstillinger. */
    const harValgtCanvasData = canvasContextSelection.announcements ||
        canvasContextSelection.courses ||
        canvasContextSelection.assignments ||
        canvasContextSelection.events;
    const sisteNySamtaleToken = useRef(newChatToken);

    const settAktivSamtale = useCallback((chatId: string | null) => {
        setAktivChatId(chatId);
        setCurrentChatId(chatId);
    }, [setCurrentChatId]);

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

    // Rydd opp animasjonsintervall ved unmount for å unngå state-oppdateringer etter unmount
    useEffect(() => {
        return () => {
            if (animationIntervalRef.current) {
                clearInterval(animationIntervalRef.current);
                animationIntervalRef.current = null;
            }
        };
    }, []);

    // KI-feilbanner basert på reelle feil (chat/dokumentanalyse) – ingen eget test-connection-kall
    const visKiFeilDetaljer = process.env.NODE_ENV === "development";
    const tilkoblingsBanner = lagTilkoblingsBanner(kiError);
    const tilkoblingsBannerVist = kiError
        ? (tilkoblingsBanner ?? { melding: t("chat.aiConnectionError"), type: "error" as const })
        : null;

    // Dokumentanalyse hook
    const { analyserDokument } = useKIDocumentAnalyse();

    // Chat history hook (lagret i DB, kryptert i backend)
    const { saveChat, loadChat: loadChatById, loading, chats } = useChatHistory();
    const aktivChat = aktivChatId ? chats.find((chat) => chat.id === aktivChatId) : undefined;

    // Auto-scroll kun når brukeren allerede er nær bunnen.
    const erNaerBunn = useCallback(() => {
        const el = meldingsContainerRef.current;
        if (!el) return true;
        const avstandTilBunn = el.scrollHeight - el.scrollTop - el.clientHeight;
        return avstandTilBunn < 96;
    }, []);

    const oppdaterBrukerScrollPosisjon = useCallback(() => {
        brukerErVedBunnRef.current = erNaerBunn();
    }, [erNaerBunn]);

    const scrollTilBunn = useCallback((behavior: ScrollBehavior = "auto") => {
        meldingerSluttRef.current?.scrollIntoView({ behavior });
    }, []);

    // Scroll til bunn når innhold vokser, men bare hvis brukeren ikke har scrollet seg bort.
    useEffect(() => {
        if (!brukerErVedBunnRef.current) return;
        scrollTilBunn(skriver || analyserarDokument || animerendeMeldingId ? "auto" : "smooth");
    }, [meldinger, skriver, analyserarDokument, animerendeMeldingId, scrollTilBunn]);

    useEffect(() => {
        meldingerRef.current = meldinger;
    }, [meldinger]);

    /** Stopper aktiv svaranimasjon uten å vente på onDone-callback. */
    const stoppAktivAnimasjon = useCallback(() => {
        if (animationIntervalRef.current) {
            clearInterval(animationIntervalRef.current);
            animationIntervalRef.current = null;
        }
        settAnimerendeMeldingId(null);
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (tekstInputRef.current) {
            tekstInputRef.current.style.height = "auto";
            tekstInputRef.current.style.height = `${tekstInputRef.current.scrollHeight}px`;
        }
    }, [tekstInput]);

    /** Lagrer nåværende meldingsliste til backend (PUT ved aktivChatId, ellers POST med valgfri title). */
    const lagreSamtale = async (oppdatert: Melding[], title?: string) => {
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
            const titleFromFirst = title ?? oppdatert.find((m) => m.rolle === "user")?.innhold?.trim().slice(0, 50) ?? "Ny samtale";
            const nyId = await saveChat(payload, undefined, titleFromFirst);
            if (nyId) settAktivSamtale(nyId);
        } finally {
            oppretterChatRef.current = false;
        }
    };

    const harSammeMeldinger = (
        current: Array<{ rolle: "user" | "assistant"; innhold: string }>,
        expected: Array<{ rolle: "user" | "assistant"; innhold: string }>,
    ) => (
        current.length === expected.length &&
        current.every((melding, index) => (
            melding.rolle === expected[index]?.rolle &&
            melding.innhold === expected[index]?.innhold
        ))
    );

    /** Oppdaterer pending state og sessionStorage med ny chat-id. Setter alltid runningChatId og currentChatId i store (så Sidebar viser pågående-markering også ved unmount); setter aktivChatId kun hvis komponenten er mountet. */
    const oppdaterPendingChatId = useCallback((requestId: string, chatId: string | undefined) => {
        if (!chatId) return;
        if (pendingConversationState?.requestId === requestId) {
            pendingConversationState = {
                ...pendingConversationState,
                chatId,
            };
            if (pendingConversationState.isResponsePending) {
                setRunningChatId(chatId);
                setCurrentChatId(chatId);
            }
        }
        try {
            sessionStorage?.setItem("studywise_last_chat_id", chatId);
        } catch {
            /* ignore */
        }
        if (isMountedRef.current) {
            settAktivSamtale(chatId);
        }
    }, [setRunningChatId, setCurrentChatId, settAktivSamtale]);

    /** Gjenoppretter meldinger og UI-state fra pending (brukes ved gjenopptak etter refresh). Bruker isResponsePending så vi ikke viser skriver/analyse-indikator når bare lagring gjenstår. */
    const hydratePendingConversation = useCallback((pending: PendingConversationState) => {
        stoppAktivAnimasjon();
        const restoredMessages = [
            ...pending.messagesBefore.map(hydrateMelding),
            hydrateMelding(pending.userMessage),
            ...(pending.assistantMessage ? [hydrateMelding(pending.assistantMessage)] : []),
        ];
        settMeldinger(restoredMessages);
        meldingerRef.current = restoredMessages;
        settAktivSamtale(pending.chatId);
        const ui = getPendingUiState(pending);
        settSkriver(ui.skriver);
        settAnalysererDokument(ui.analysererDokument);
    }, [settAktivSamtale, stoppAktivAnimasjon]);

    /** Sjekker om synlig samtale fortsatt tilsvarer denne forespørselen (samme chat + samme meldinger). */
    const kanOppdatereSynligSamtale = (pending: NonNullable<typeof pendingChatRef.current>) => {
        const expectedMessages = [...pending.messagesBefore, pending.userMessage].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        const sameChat = pending.chatId ? aktivChatId === pending.chatId : true;
        const currentMessages = meldingerRef.current.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        return sameChat && harSammeMeldinger(currentMessages, expectedMessages);
    };

    /** Finner pending state som faktisk matcher chatten brukeren ser pa akkurat na. */
    const hentSynligPendingConversation = useCallback(() => {
        const pending = pendingConversationState;
        if (!pending) return null;
        if (pending.chatId && aktivChatId && pending.chatId !== aktivChatId) {
            return null;
        }

        const currentMessages = meldingerRef.current.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        const expectedMessages = [
            ...pending.messagesBefore,
            pending.userMessage,
            ...(pending.assistantMessage ? [pending.assistantMessage] : []),
        ].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));

        return harSammeMeldinger(currentMessages, expectedMessages) ? pending : null;
    }, [aktivChatId]);

    /** Lagrer kun brukermelding(er) i backend ved feil/tomt svar, slik at meldingen ikke forsvinner ved reload (særlig viktig for eksisterende chat der vi ikke kaller saveChat tidlig). */
    const persistUserMessageOnly = async (pending: NonNullable<typeof pendingChatRef.current>) => {
        const resolvedChatId = pending.chatId ?? await pending.chatIdPromise;
        if (resolvedChatId) {
            oppdaterPendingChatId(pending.requestId, resolvedChatId);
        }
        const payload = [...pending.messagesBefore, pending.userMessage].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        await saveChat(
            payload,
            resolvedChatId ?? undefined,
            resolvedChatId ? undefined : pending.title,
            { silent: true, retryCount: 1 },
        );
    };

    /** Lagrer full samtale (bruker + assistent-svar) i backend; oppdaterer pending state og evt. aktivChatId. */
    const persistPendingConversation = async (
        pending: NonNullable<typeof pendingChatRef.current>,
        sisteMelding: Melding,
    ) => {
        const resolvedChatId = pending.chatId ?? await pending.chatIdPromise;
        if (resolvedChatId) {
            oppdaterPendingChatId(pending.requestId, resolvedChatId);
        }
        if (pendingConversationState?.requestId === pending.requestId) {
            pendingConversationState = {
                ...pendingConversationState,
                chatId: resolvedChatId ?? pendingConversationState.chatId,
                assistantMessage: serializeMelding(sisteMelding),
            };
        }
        const payload = [...pending.messagesBefore, pending.userMessage, sisteMelding].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        const savedChatId = await saveChat(
            payload,
            resolvedChatId ?? undefined,
            resolvedChatId ? undefined : pending.title,
            { silent: true, retryCount: 1 },
        );
        if (savedChatId && pendingConversationState?.requestId === pending.requestId) {
            pendingConversationState = null;
        } else if (!savedChatId && pendingConversationState?.requestId === pending.requestId) {
            pendingConversationState = {
                ...pendingConversationState,
                status: "failed",
                chatId: resolvedChatId ?? pendingConversationState.chatId,
            };
        }
        if (
            savedChatId &&
            !pending.chatId &&
            isMountedRef.current &&
            kanOppdatereSynligSamtale(pending)
        ) {
            settAktivSamtale(savedChatId);
        }
    };

    /** Prøver å lagre en tidligere feilet pending samtale på nytt (med høyere retryCount). */
    const retryFailedPendingConversation = useCallback(async (pending: PendingConversationState) => {
        if (pending.status !== "failed" || !pending.assistantMessage) return;

        const savedChatId = await saveChat(
            buildPendingPayload(pending),
            pending.chatId ?? undefined,
            pending.chatId ? undefined : pending.title,
            { silent: true, retryCount: 2 },
        );

        if (!savedChatId || pendingConversationState?.requestId !== pending.requestId) {
            return;
        }

        oppdaterPendingChatId(pending.requestId, savedChatId);
        pendingConversationState = null;

        if (isMountedRef.current && (!aktivChatId || aktivChatId === pending.chatId)) {
            settAktivSamtale(savedChatId);
        }
    }, [aktivChatId, oppdaterPendingChatId, saveChat, settAktivSamtale]);

    /** Nullstiller state for ny samtale; lagrer gjeldende meldinger først og tømmer sessionStorage. */
    const nySamtale = async () => {
        if (meldinger.length > 0) {
            void lagreSamtale(meldinger).catch(() => {
                showToast.error(t("chat.saveBeforeNewError"));
            });
        }
        stoppAktivAnimasjon();
        pendingChatRef.current = null;
        pendingConversationState = null;
        docAnalysisChatIdRef.current = null;
        setRunningChatId(null);
        settMeldinger([]);
        settAktivSamtale(null);
        settVedlegg([]);
        settSkriver(false);
        settAnalysererDokument(false);
        try {
            sessionStorage?.removeItem("studywise_last_chat_id");
        } catch {
            /* ignore */
        }
    };

    /** Reagerer på "Ny samtale"-knapp i sidebar: nullstiller og starter ny samtale. */
    useEffect(() => {
        if (sisteNySamtaleToken.current === newChatToken) return;
        sisteNySamtaleToken.current = newChatToken;
        void nySamtale();
    }, [newChatToken]);

    /** Validerer filstørrelse (max 15 MB), viser toast ved for mange, setter ett vedlegg. */
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
            showToast.info(t("chat.oneAttachmentOnly"), t("chat.oneAttachmentOnlyDescription"));
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

    /**
     * Animerer assistent-svar ord-for-ord ved å progressivt oppdatere meldingen med gitt ID.
     */
    const animerTekst = useCallback(
        (id: string, fullText: string, onDone: () => void) => {
            stoppAktivAnimasjon();
            settAnimerendeMeldingId(id);
            const tokens = fullText.split(/(\s+)/);
            let index = 0;
            const steg = Math.max(1, Math.ceil(tokens.length / 180));
            animationIntervalRef.current = setInterval(() => {
                index = Math.min(index + steg, tokens.length);
                settMeldinger((prev) =>
                    prev.map((m) =>
                        m.id === id ? { ...m, innhold: tokens.slice(0, index).join("") } : m,
                    ),
                );
                if (index >= tokens.length) {
                    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
                    animationIntervalRef.current = null;
                    settAnimerendeMeldingId(null);
                    onDone();
                }
            }, 16);
        },
        [stoppAktivAnimasjon],
    );

    /** Hovedfunksjon: validerer input, legger til brukermelding, og enten kjører dokumentanalyse eller sender til KI-chat. Oppretter chat ved behov og setter pending state. */
    const sendMelding = async ({
        forcedText,
        skipCanvasValidation = false,
    }: SendMeldingOptions = {}) => {
        const råTekst = forcedText ?? tekstInput;
        const trimmetTekst = råTekst.trim();
        const harVedlegg = vedlegg.length > 0;
        if ((!trimmetTekst && !harVedlegg) || skriver || analyserarDokument) return;

        const vedlagtNavn = vedlegg.map((f) => f.name).join(", ");
        const brukerMeldingInnhold = trimmetTekst || (harVedlegg ? `Analyser dokumentet: ${vedlagtNavn}` : "");
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

        /* Vedlegg: opprett chat om nødvendig, sett pending (document), kjør dokumentanalyse og lagre i onSuccess/onError. */
        if (harVedlegg) {
            settAnalysererDokument(true);
            const filTilAnalyse = vedlegg[0];
            settVedlegg([]);
            const titleFromFirst = brukerMeldingInnhold.trim().slice(0, 50) || "Ny samtale";
            const requestId = createPendingRequestId();
            docAnalysisChatIdRef.current = aktivChatId;
            const messagesBeforeForSave = [...meldinger, brukerMelding].map((m) => ({
                rolle: m.rolle as "user" | "assistant",
                innhold: m.innhold,
            }));
            pendingConversationState = {
                requestId,
                chatId: aktivChatId,
                title: titleFromFirst,
                messagesBefore: meldinger.map(serializeMelding),
                userMessage: serializeMelding(brukerMelding),
                mode: "document",
                status: "pending",
                isResponsePending: true,
            };
            setRunningChatId(aktivChatId);
            const docChatIdPromise = aktivChatId
                ? Promise.resolve(aktivChatId)
                : saveChat(
                    [{ rolle: "user" as const, innhold: brukerMeldingInnhold }],
                    undefined,
                    titleFromFirst,
                    { silent: true, retryCount: 1 },
                ).then((nyId) => {
                    if (nyId) {
                        docAnalysisChatIdRef.current = nyId;
                    }
                    oppdaterPendingChatId(requestId, nyId);
                    return nyId;
                });

            const persistDocumentResult = async (
                payload: Array<{ rolle: "user" | "assistant"; innhold: string }>,
                assistantSnapshot: PendingMeldingSnapshot,
            ) => {
                const resolvedChatId = docAnalysisChatIdRef.current ?? await docChatIdPromise;
                if (resolvedChatId) oppdaterPendingChatId(requestId, resolvedChatId);
                if (pendingConversationState?.requestId === requestId) {
                    pendingConversationState = {
                        ...pendingConversationState,
                        chatId: resolvedChatId ?? pendingConversationState.chatId,
                        isResponsePending: false,
                        assistantMessage: assistantSnapshot,
                    };
                }
                setRunningChatId(null);
                const savedChatId = await saveChat(
                    payload,
                    resolvedChatId ?? undefined,
                    resolvedChatId ? undefined : titleFromFirst,
                    { silent: true, retryCount: 1 },
                );
                if (savedChatId && pendingConversationState?.requestId === requestId) {
                    pendingConversationState = null;
                } else if (!savedChatId && pendingConversationState?.requestId === requestId) {
                    pendingConversationState = {
                        ...pendingConversationState,
                        status: "failed",
                        chatId: resolvedChatId ?? pendingConversationState.chatId,
                    };
                }
            };

            const avsluttDokumentanalyseUtenSvar = () => {
                if (pendingConversationState?.requestId === requestId) {
                    pendingConversationState = null;
                }
                docAnalysisChatIdRef.current = null;
                setRunningChatId(null);
                if (isMountedRef.current) {
                    settAnalysererDokument(false);
                }
            };

            /** Lagrer kun brukermelding ved feil/tomt svar (én sted – brukes i onSuccess tom og onError). */
            const persistDocumentUserMessageOnly = () => {
                void (async () => {
                    try {
                        const id = docAnalysisChatIdRef.current ?? await docChatIdPromise;
                        await saveChat(messagesBeforeForSave, id ?? undefined, id ? undefined : titleFromFirst, { silent: true, retryCount: 1 });
                    } catch {
                        // Feil ved lagring av dokument-brukermelding - ikke kritisk
                    }
                })();
            };

            analyserDokument(filTilAnalyse, brukerMeldingInnhold || "Gi meg en oppsummering av dette dokumentet.", {
                onSuccess: (data) => {
                    const responseText = data.response.trim();
                    if (!responseText) {
                        showToast.error(t("chat.documentAnalysisFailed"), t("chat.documentAnalysisEmpty"));
                        if (isMountedRef.current) {
                            settMeldinger((prev) =>
                                prev.map((m) =>
                                    m.id === brukerMelding.id ? { ...m, feilet: true } : m,
                                ),
                            );
                        }
                        persistDocumentUserMessageOnly();
                        avsluttDokumentanalyseUtenSvar();
                        return;
                    }

                    const aiInnhold = data.dokumentInfo
                        ? `${responseText}\n\n---\n_${t("chat.documentAnalysisMetadata", {
                            pages: String(data.dokumentInfo.sider),
                            characters: formaterTall(data.dokumentInfo.tegn, language),
                            truncated: data.dokumentInfo.truncated
                                ? t("chat.documentAnalysisMetadataTruncated")
                                : "",
                        })}_`
                        : responseText;
                    const aiMelding: Melding = {
                        id: (Date.now() + 1).toString(),
                        rolle: "assistant",
                        innhold: aiInnhold,
                        tidsstempel: new Date(),
                    };
                    const payload = [
                        ...messagesBeforeForSave,
                        { rolle: "assistant" as const, innhold: aiInnhold },
                    ];
                    void persistDocumentResult(payload, serializeMelding(aiMelding));
                    if (isMountedRef.current) {
                        settMeldinger((tidligere) => [...tidligere, aiMelding]);
                        settAnalysererDokument(false);
                    }
                },
                onError: (error) => {
                    settKiError(error instanceof Error ? error : new Error(String(error)));
                    showToast.error(t("chat.documentAnalysisFailed"), lagFeilTekst(error instanceof Error ? error : new Error(String(error)), "dokument"));
                    // Marker brukerens melding som feilet
                    if (isMountedRef.current) {
                        settMeldinger((prev) =>
                            prev.map((m) =>
                                m.id === brukerMelding.id ? { ...m, feilet: true } : m,
                            ),
                        );
                    }
                    persistDocumentUserMessageOnly();
                    avsluttDokumentanalyseUtenSvar();
                },
            });
            return;
        }

        /* Vanlig chat: valider Canvas-kontekst FØR noe lagres, deretter opprett chat og send til API. */

        // Detektér hvilken type Canvas-data brukeren spør om
        const spørOmKunngjøringer = /kunngjør|announcement|beskjed|melding fra foreleser/i.test(brukerMeldingInnhold);
        const spørOmEmner = /emne|course|fag|kurs(?!gjøring)/i.test(brukerMeldingInnhold);
        const spørOmOppgaver = /oppgave|assignment|innlevering|frist|deadline|todo|gjøremål/i.test(brukerMeldingInnhold);
        const spørOmHendelser = /hendelse|event|kalender|møte|forelesning/i.test(brukerMeldingInnhold);
        const spørOmCanvas = spørOmKunngjøringer || spørOmEmner || spørOmOppgaver || spørOmHendelser ||
            /canvas|data|mine|hva har jeg/i.test(brukerMeldingInnhold);

        // Sjekk om bruker spør om noe som ikke er valgt i innstillinger — STOPP FØR vi oppretter chat
        if (!skipCanvasValidation && spørOmCanvas) {
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
                return;
            }
        }

        // Canvas-validering passert — nå kan vi sette pending state og opprette chat
        settSkriver(true);

        const titleFromFirst = brukerMeldingInnhold.trim().slice(0, 50) || "Ny samtale";
        const requestId = createPendingRequestId();
        pendingConversationState = {
            requestId,
            chatId: aktivChatId,
            title: titleFromFirst,
            messagesBefore: meldinger.map(serializeMelding),
            userMessage: serializeMelding(brukerMelding),
            mode: "chat",
            status: "pending",
            isResponsePending: true,
        };
        setRunningChatId(aktivChatId);

        const chatIdPromise = aktivChatId
            ? Promise.resolve(aktivChatId)
            : saveChat(
                [{ rolle: "user" as const, innhold: brukerMeldingInnhold }],
                undefined,
                titleFromFirst,
                { silent: true, retryCount: 1 },
            ).then((nyId) => {
                oppdaterPendingChatId(requestId, nyId);
                return nyId;
            });

        // Sett pending én gang med endelig chatId, så persistPendingConversation alltid oppdaterer riktig chat
        pendingChatRef.current = {
            requestId,
            chatId: aktivChatId,
            chatIdPromise,
            title: titleFromFirst,
            messagesBefore: [...meldinger],
            userMessage: brukerMelding,
        };

        // Kun user/assistant sendes til API (KIChatClientMessageSchema); system styres av backend (prompt-injection-sikring).
        const apiMeldinger = [
            ...meldinger.map((m) => ({
                role: m.rolle === "user" ? ("user" as const) : ("assistant" as const),
                content: m.innhold,
            })),
            { role: "user" as const, content: brukerMeldingInnhold },
        ];

        /** Oppdaterer pending state og lagrer i DB. Se opts for å styre state/skriver-sideeffekter. */
        const handleChatResponse = (
            sisteMelding?: Melding,
            opts: { skipMeldingerUpdate?: boolean; skipSkriver?: boolean } = {},
        ): boolean => {
            const pending = pendingChatRef.current;
            if (pending && pendingConversationState?.requestId === pending.requestId) {
                pendingConversationState = sisteMelding
                    ? {
                        ...pendingConversationState,
                        isResponsePending: false,
                    }
                    : null;
            }
            setRunningChatId(null);
            pendingChatRef.current = null;
            const skalOppdatereSynlig = pending ? kanOppdatereSynligSamtale(pending) : false;
            if (pending && sisteMelding) {
                void persistPendingConversation(pending, sisteMelding);
            } else if (pending?.chatId) {
                /* Eksisterende chat: brukermelding ble ikke lagret tidlig – lagre nå ved feil/tomt svar. Ny chat har allerede POST i chatIdPromise, så unngå redundant PUT. */
                void persistUserMessageOnly(pending);
            }
            if (isMountedRef.current) {
                if (!opts.skipMeldingerUpdate && skalOppdatereSynlig && sisteMelding) {
                    settMeldinger((t) => [...t, sisteMelding]);
                }
                if (!opts.skipSkriver) settSkriver(false);
            }
            return skalOppdatereSynlig;
        };

        // Assistent-boble legges først til når vi faktisk starter animasjonen.
        const assistantId = (Date.now() + 1).toString();
        brukerErVedBunnRef.current = true;

        void streamKIChat(apiMeldinger)
            .then((data) => {
                const responseText = data.response.trim();
                if (!responseText) {
                    showToast.error(t("chat.aiResponseFailed"), t("chat.aiResponseEmpty"));
                    settAnimerendeMeldingId(null);
                    // Marker brukerens melding som feilet
                    if (isMountedRef.current) {
                        settMeldinger((prev) =>
                            prev.map((m) =>
                                m.id === brukerMelding.id ? { ...m, feilet: true } : m,
                            ),
                        );
                    }
                    handleChatResponse();
                    return;
                }

                const sisteMelding: Melding = {
                    id: assistantId,
                    rolle: "assistant",
                    innhold: responseText,
                    tidsstempel: new Date(),
                };

                // Lagre i DB umiddelbart; state-oppdatering og skriver-deaktivering skjer etter animasjon
                const skalOppdatereSynlig = handleChatResponse(sisteMelding, {
                    skipMeldingerUpdate: true,
                    skipSkriver: true,
                });

                if (isMountedRef.current && skalOppdatereSynlig) {
                    settMeldinger((t) => [
                        ...t,
                        { id: assistantId, rolle: "assistant" as const, innhold: "", tidsstempel: new Date() },
                    ]);
                    animerTekst(assistantId, responseText, () => {
                        if (isMountedRef.current) {
                            // Sikrer at full tekst er satt selv om intervallet ble ryddet tidlig
                            settMeldinger((prev) =>
                                prev.map((m) => (m.id === assistantId ? sisteMelding : m)),
                            );
                            settSkriver(false);
                        }
                    });
                } else {
                    settAnimerendeMeldingId(null);
                    settSkriver(false);
                }
            })
            .catch((error: unknown) => {
                settAnimerendeMeldingId(null);
                const err = error instanceof Error ? error : new Error("Uventet feil");
                settKiError(err);
                showToast.error(t("chat.aiResponseFailed"), lagFeilTekst(err, "chat"));
                // Marker brukerens melding som feilet slik at retry-knapp vises
                if (isMountedRef.current) {
                    settMeldinger((prev) =>
                        prev.map((m) =>
                            m.id === brukerMelding.id ? { ...m, feilet: true } : m,
                        ),
                    );
                }
                handleChatResponse();
            });
    };

    sendMeldingRef.current = sendMelding;

    /** Enter sender melding; Shift+Enter gir ny linje. */
    const handterTastetrykk = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMelding();
        }
    };

    const handterForslag = (forslagTekst: string) => {
        settTekstInput(forslagTekst);
        tekstInputRef.current?.focus();
    };

    /** Sender forhåndsdefinert melding fra andre seksjoner (f.eks. Canvas -> KI-chat). */
    useEffect(() => {
        if (!mounted || loading || !pendingKIMelding) return;
        if (selectedChatId || aktivChatId || meldinger.length > 0) return;
        if (skriver || analyserarDokument || pendingConversationState) return;

        clearPendingKIMelding();
        void sendMeldingRef.current({
            forcedText: pendingKIMelding.melding,
            skipCanvasValidation: pendingKIMelding.skipCanvasValidation,
        });
    }, [
        aktivChatId,
        analyserarDokument,
        clearPendingKIMelding,
        loading,
        meldinger.length,
        mounted,
        pendingKIMelding,
        selectedChatId,
        skriver,
    ]);

    /** Gjenopptar pending samtale ved mount, eller åpner sist opprettede chat fra sessionStorage ved tilbakekomst. */
    useEffect(() => {
        if (pendingKIMelding) return;
        if (!loading && meldinger.length === 0 && !selectedChatId && pendingConversationState) {
            hydratePendingConversation(pendingConversationState);
            return;
        }
        if (loading || chats.length === 0 || aktivChatId || selectedChatId || meldinger.length > 0) return;
        try {
            const lastId = sessionStorage?.getItem("studywise_last_chat_id");
            if (lastId && chats.some((c) => c.id === lastId)) setSelectedChatId(lastId);
            sessionStorage?.removeItem("studywise_last_chat_id");
        } catch {
            /* ignore */
        }
    }, [loading, chats, aktivChatId, selectedChatId, meldinger.length, setSelectedChatId, hydratePendingConversation, pendingKIMelding]);

    /** Ved mount: prøver én gang å lagre på nytt en pending som feilet (status === "failed"). */
    useEffect(() => {
        const pending = pendingConversationState;
        if (!mounted || !pending || pending.status !== "failed" || !pending.assistantMessage) {
            return;
        }
        if (retriedPendingSaveRef.current === pending.requestId) {
            return;
        }
        retriedPendingSaveRef.current = pending.requestId;
        void retryFailedPendingConversation(pending);
    }, [mounted, retryFailedPendingConversation]);

    /** Holder lokal pending-UI i synk med den samtalen som faktisk er synlig. */
    useEffect(() => {
        if (animerendeMeldingId) return;
        const pendingUi = getPendingUiState(hentSynligPendingConversation());
        if (skriver !== pendingUi.skriver) {
            settSkriver(pendingUi.skriver);
        }
        if (analyserarDokument !== pendingUi.analysererDokument) {
            settAnalysererDokument(pendingUi.analysererDokument);
        }
    }, [
        animerendeMeldingId,
        analyserarDokument,
        hentSynligPendingConversation,
        meldinger,
        skriver,
    ]);

    /** Laster chat valgt fra sidebar inn i meldinger og setter aktivChatId; nullstiller selectedChatId etter lasting. */
    useEffect(() => {
        if (!selectedChatId) return;
        const chat = loadChatById(selectedChatId);
        if (chat && isMountedRef.current) {
            stoppAktivAnimasjon();
            const pending = pendingChatRef.current;
            const globalPending = pendingConversationState;
            const pendingForChat: PendingConversationState | null = globalPending?.chatId === chat.id
                ? globalPending
                : (pending?.chatId === chat.id
                    ? {
                        requestId: pending.requestId,
                        chatId: chat.id,
                        title: pending.title,
                        messagesBefore: pending.messagesBefore.map(serializeMelding),
                        userMessage: serializeMelding(pending.userMessage),
                        mode: "chat" as const,
                        status: "pending" as const,
                        isResponsePending: true,
                    }
                    : null);
            const messagesToShow = pendingForChat
                ? [
                    ...pendingForChat.messagesBefore.map(hydrateMelding),
                    hydrateMelding(pendingForChat.userMessage),
                    ...(pendingForChat.assistantMessage ? [hydrateMelding(pendingForChat.assistantMessage)] : []),
                  ]
                : chat.messages.map((m, i) => ({
                    id: `${Date.now()}-${i}`,
                    rolle: m.rolle,
                    innhold: m.innhold,
                    tidsstempel: new Date(),
                }));
            settMeldinger(
                messagesToShow,
            );
            settAktivSamtale(chat.id);
            const pendingUi = getPendingUiState(pendingForChat);
            settSkriver(pendingUi.skriver);
            settAnalysererDokument(pendingUi.analysererDokument);
            setSelectedChatId(null);
            return;
        }

        if (!loading) {
            setSelectedChatId(null);
        }
    }, [selectedChatId, loadChatById, setSelectedChatId, loading, settAktivSamtale, stoppAktivAnimasjon]);

    /** Synkroniserer meldinger med cache når aktivChatId endres og det ikke er pågående forespørsel for den chatten. */
    useEffect(() => {
        if (!aktivChatId || loading) return;
        const chat = loadChatById(aktivChatId);
        if (!chat) {
            const pending = pendingChatRef.current;
            if ((pending && pending.chatId === aktivChatId) || pendingConversationState?.chatId === aktivChatId) return;
            if (animerendeMeldingId) return;

            stoppAktivAnimasjon();
            settMeldinger([]);
            meldingerRef.current = [];
            settAktivSamtale(null);
            setSelectedChatId(null);
            settSkriver(false);
            settAnalysererDokument(false);
            return;
        }
        const pending = pendingChatRef.current;
        if ((pending && pending.chatId === aktivChatId) || pendingConversationState?.chatId === aktivChatId) return;
        // Ikke overskriv meldingsinnhold mens pågående AI-svar animeres ord-for-ord.
        if (animerendeMeldingId) return;

        const currentMessages = meldingerRef.current.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        const savedMessages = chat.messages.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
        }));
        if (harSammeMeldinger(currentMessages, savedMessages)) return;

        settMeldinger(chat.messages.map((m, i) => ({
            id: `${Date.now()}-${i}`,
            rolle: m.rolle,
            innhold: m.innhold,
            tidsstempel: new Date(),
        })));
    }, [aktivChatId, chats, loadChatById, loading, animerendeMeldingId, setSelectedChatId, settAktivSamtale, stoppAktivAnimasjon]);

    const sisteAssistentsvar =
        [...meldinger].reverse().find((melding) => melding.rolle === "assistant")?.innhold ?? "";
    const delingsTittel =
        aktivChat?.title?.trim() ||
        meldinger.find((melding) => melding.rolle === "user")?.innhold?.trim().slice(0, 50) ||
        "Samtale";

    const opprettDelingslenke = useCallback(async () => {
        if (oppretterDeling) return null;
        setOppretterDeling(true);
        try {
            let chatId = aktivChatId;

            if (!chatId && meldingerRef.current.length > 0) {
                const titleFromFirst =
                    meldingerRef.current.find((melding) => melding.rolle === "user")?.innhold?.trim().slice(0, 50) ||
                    "Ny samtale";
                const savedChatId = await saveChat(
                    meldingerRef.current.map((melding) => ({
                        rolle: melding.rolle,
                        innhold: melding.innhold,
                    })),
                    undefined,
                    titleFromFirst,
                    { silent: true, retryCount: 1 },
                );

                if (savedChatId) {
                    chatId = savedChatId;
                    settAktivSamtale(savedChatId);
                }
            }

            if (!chatId) {
                showToast.info(t("chat.saveBeforeShare"));
                return null;
            }

            const res = await fetchApi(`/api/ki/chat/${chatId}/share`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shareMode: "full_chat",
                }),
            });

            if (!res.ok) {
                throw new Error(await parseApiError(res, t("chat.couldNotShareChat")));
            }

            const data = ChatShareResponseSchema.parse(await res.json());
            const fullUrl = `${window.location.origin}${data.shareUrl}`;
            return { shareUrl: fullUrl };
        } catch (error) {
            const meldingTekst = error instanceof Error
                ? error.message
                : t("chat.couldNotShareChatFallback");
            showToast.error(meldingTekst);
            return null;
        } finally {
            setOppretterDeling(false);
        }
    }, [aktivChatId, oppretterDeling, saveChat, settAktivSamtale, t]);

    return (
        <div className="h-full flex">
            <ChatShareModal
                isOpen={viserShareModal}
                onClose={() => {
                    if (!oppretterDeling) {
                        setViserShareModal(false);
                    }
                }}
                onGenerate={opprettDelingslenke}
                isPending={oppretterDeling}
                chatTitle={delingsTittel}
                messageCount={meldinger.length}
            />
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Meldinger */}
                <div
                    ref={meldingsContainerRef}
                    onScroll={oppdaterBrukerScrollPosisjon}
                    className="flex-1 overflow-y-auto p-4 md:p-6"
                >
                  <div className="max-w-235 mx-auto space-y-5">
                    {/* Tilkoblingsfeil – samme FeilMelding + Prøv igjen-UI som DashboardView/oversikt (konsekvent UX) */}
                    {tilkoblingsBannerVist && (
                        <div className="space-y-4">
                            <FeilMelding
                                melding={tilkoblingsBannerVist.melding}
                                type={tilkoblingsBannerVist.type}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => settKiError(null)}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" aria-hidden />
                                    Prøv igjen
                                </button>
                                {visKiFeilDetaljer && kiError && (
                                    <details className="w-full max-w-235">
                                        <summary className="cursor-pointer text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                                            Vis feildetaljer (debug)
                                        </summary>
                                        <pre className="mt-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-left overflow-x-auto break-all">
                                            {kiError.message}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Placeholder før hydration - matcher server-rendering */}
                    {!mounted && (
                        <div className="py-12">
                            <LoadingView text={t("chat.loadingGeneric")} fullPage={false} />
                        </div>
                    )}

                    {/* Loading state - vis kun etter mount for å unngå hydration mismatch */}
                    {mounted && loading && (
                        <div className="py-12">
                            <LoadingView text={t("chat.loadingChatHistory")} fullPage={false} />
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
                                        type="button"
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
                                    <ConversationMessageContent message={melding} />
                                </div>

                                {/* Retry-knapp under feilede brukermeldinger */}
                                {melding.rolle === "user" && melding.feilet && (
                                    <div className="flex items-center gap-2 mt-1.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                // Fjern feilet-melding, sett tekst og send på nytt
                                                settMeldinger((prev) => prev.filter((m) => m.id !== melding.id));
                                                settKiError(null);
                                                settTekstInput(melding.innhold);
                                                // Liten delay slik at state oppdateres før sending
                                                setTimeout(() => {
                                                    tekstInputRef.current?.focus();
                                                }, 50);
                                            }}
                                            disabled={skriver || analyserarDokument}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" />
                                            Prøv igjen
                                        </button>
                                        <span className="text-xs text-red-500 dark:text-red-400">Sending feilet</span>
                                    </div>
                                )}

                                {/* Handlingsknapper under AI-svar */}
                                {melding.rolle === "assistant" && animerendeMeldingId !== melding.id && !skriver && (
                                    <div className="flex items-center mt-1.5 px-0.5">
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(melding.innhold);
                                                        showToast.success(t("chat.copiedToClipboard"));
                                                    } catch {
                                                        showToast.error(t("chat.couldNotCopy"));
                                                    }
                                                }}
                                                className={actionBtnClass}
                                                title="Kopier"
                                            >
                                                <Copy className="w-4 h-4" />
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
                    {((skriver && !animerendeMeldingId) || analyserarDokument) && (
                        <div className="flex items-start gap-3 justify-start">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                                <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="py-3">
                                {analyserarDokument ? (
                                    <div className="flex items-center gap-2">
                                        <LoadingSpinner className="w-4 h-4" />
                                        <span className="text-sm text-slate-500 dark:text-slate-400">{t("chat.analyzingDocument")}</span>
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
                {meldinger.length > 0 && !skriver && !analyserarDokument && sisteAssistentsvar && (
                    <SmartSuggestions
                        lastAIMessage={sisteAssistentsvar}
                        onSelectSuggestion={(suggestion) => {
                            settTekstInput(suggestion);
                            tekstInputRef.current?.focus();
                        }}
                    />
                )}

                {/* Input */}
                <div className="shrink-0 px-4 md:px-6 pb-4 pt-3">
                  <div className="max-w-235 mx-auto">
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

                        {/* Del samtale */}
                        <button
                            type="button"
                            onClick={() => setViserShareModal(true)}
                            disabled={meldinger.length === 0 || skriver || analyserarDokument}
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Del hele samtalen"
                            aria-label="Del samtale"
                        >
                            <Share2 className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>

                        {/* Eksporter samtale som Markdown */}
                        <button
                            type="button"
                            onClick={() => {
                                if (meldinger.length === 0) return;
                                exportToMarkdown(
                                    meldinger.map((m) => ({
                                        rolle: m.rolle,
                                        innhold: m.innhold,
                                        tidsstempel: m.tidsstempel,
                                    })),
                                    undefined,
                                    "studywise-samtale",
                                );
                                showToast.success(t("chat.conversationDownloaded"));
                            }}
                            disabled={meldinger.length === 0 || skriver || analyserarDokument}
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Eksporter samtale (MD)"
                            aria-label="Eksporter samtale som Markdown"
                        >
                            <Download className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>

                        {/* Filopplasting */}
                        <button
                            type="button"
                            onClick={() => filInputRef.current?.click()}
                            disabled={skriver || analyserarDokument}
                            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title="Last opp dokument (PDF, Word, PowerPoint, Excel, kodefiler, bilder)"
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
                            type="button"
                            onClick={() => {
                                void sendMelding();
                            }}
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

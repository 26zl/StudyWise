/*
 * ChatSection – KI-chatgrensesnitt (meldinger, input, vedlegg, dokumentanalyse).
 * Håndterer: vanlig chat, dokumentanalyse med vedlegg, lagring ved første melding,
 * pending state ved navigering, gjenåpning av siste chat (sessionStorage), og eksport til MD.
 */
"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Square, Bot, Upload, Copy, Share2, RefreshCw, Plus, User, GraduationCap, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { LoadingSpinner, LoadingView } from "@/app/components/ui/Loading";
import { RotatingStatusMessage } from "@/app/components/ui/RotatingStatusMessage";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { AttachmentStrip } from "@/app/components/chat/AttachmentStrip";
import { ChatShareModal } from "@/app/components/chat/ChatShareModal";
import { ChatExportModal } from "@/app/components/chat/ChatExportModal";
import { ConversationMessageContent } from "@/app/components/chat/ConversationMessageContent";
import { appendKilderToMarkdown, isSafeExternalUrl } from "@/app/lib/kildeFormat";
import { SmartSuggestions } from "@/app/components/chat/SmartSuggestions";
import { ChatShareResponseSchema } from "common/chat";
import { streamKIChat, useKIDocumentAnalyse, useKIModels, SUPPORTED_FILE_TYPES, getKIErrorMessage, getKIBannerForError, type KIErrorContext } from "@/app/ki/ki-api";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { FeilMelding, type FeilMeldingType } from "@/app/components/ui/FeilMelding";
import { useUIStore } from "@/app/store/uiStore";
import { useKIStore } from "@/app/store/kiStore";
import { fetchApi, downloadAuthedFile } from "@/app/lib/apiClient";
import { formaterTall } from "@/app/lib/dato";
import { parseApiError } from "@/app/lib/errorUtils";
import { useMeg } from "@/app/auth/auth-api";

const ALLOWED_CHAT_MODEL_IDS = new Set([
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
]);

/** Én melding i chatten (bruker eller assistent), med id og evt. vedleggsnavn. */
interface Melding {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: Date;
    vedleggNavn?: string[];
    /** Markerer at KI-svaret feilet for denne brukerforespørselen */
    feilet?: boolean;
    /** Kilder (Canvas-filer) som ble brukt i KI-svaret — vises som klikkbar liste */
    kilder?: import("common/ki").KIChatSource[];
}

/**
 * Pretty-printer filnavn som kan være URL-encodet (Canvas legger inn %C3%B8 for ø,
 * + for mellomrom osv.). Dekoder trygt og faller tilbake til rå-navn hvis
 * decoding feiler på ødelagte prosent-sekvenser.
 */
function visFilnavn(fileName: string | null | undefined): string {
    if (!fileName) return "";
    try {
        return decodeURIComponent(fileName.replace(/\+/g, " "));
    } catch {
        return fileName;
    }
}

function hentVisbareKilder(melding: Melding): import("common/ki").KIChatSource[] {
    const kilder = melding.kilder ?? [];
    const dedupe = new Set<string>();
    const filtered: import("common/ki").KIChatSource[] = [];
    for (const kilde of kilder) {
        const hasCanvasFile = Number.isFinite(kilde.fileId);
        const hasUrl = typeof kilde.sourceUrl === "string" && kilde.sourceUrl.length > 0;
        const hasKbFile =
            kilde.sourceKind === "kb_file" &&
            typeof kilde.baseId === "string" &&
            typeof kilde.sourceId === "string";
        if (!hasCanvasFile && !hasUrl && !hasKbFile) continue;
        const key = `${kilde.sourceKind ?? "canvas_file"}:${kilde.courseId}:${kilde.fileId ?? "na"}:${kilde.fileName}:${kilde.sourceUrl ?? ""}:${kilde.sourceId ?? ""}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        filtered.push(kilde);
    }
    return filtered;
}


/** Serialisert melding (tidsstempel som ISO-streng) for lagring i modulstate. */
type PendingMeldingSnapshot = {
    id: string;
    rolle: "user" | "assistant";
    innhold: string;
    tidsstempel: string;
    vedleggNavn?: string[];
    kilder?: import("common/ki").KIChatSource[];
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
        kilder: melding.kilder,
    };
}

function hydrateMelding(snapshot: PendingMeldingSnapshot): Melding {
    return {
        id: snapshot.id,
        rolle: snapshot.rolle,
        innhold: snapshot.innhold,
        tidsstempel: new Date(snapshot.tidsstempel),
        vedleggNavn: snapshot.vedleggNavn,
        kilder: snapshot.kilder,
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
        kilder: melding.kilder,
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

function hentKontoFornavn(input: {
    firstName?: string | null;
    username?: string | null;
    email?: string | null;
} | null | undefined): string | null {
    const epostLocalPart = typeof input?.email === "string" ? input.email.split("@")[0] : null;
    const kandidater = [input?.firstName, input?.username, epostLocalPart];
    for (const kandidat of kandidater) {
        if (typeof kandidat !== "string") continue;
        const renset = kandidat
            .replace(/[._-]+/g, " ")
            .replace(/[^\p{L}\p{M}\s'-]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!renset) continue;
        const fornavn = renset.split(" ")[0]?.trim();
        if (fornavn) return fornavn.slice(0, 40);
    }
    return null;
}

export function ChatSection() {
    const { language, t } = useLanguage();
    const forslag = [
        t("chatSection.weekPriorities"),
        t("chatSection.registeredCourses"),
        t("chatSection.summarizeAnnouncements"),
        t("chatSection.latestModule"),
    ];
    const [mounted, setMounted] = useState(false);
    const [meldinger, settMeldinger] = useState<Melding[]>([]);
    // Lokal cache for tommel-feedback per melding-id (kun for å vise active state).
    const [feedbackMap, settFeedbackMap] = useState<Record<string, "up" | "down">>({});
    const [tekstInput, settTekstInput] = useState("");
    const [skriver, settSkriver] = useState(false);
    const [vedlegg, settVedlegg] = useState<File[]>([]);
    const [analyserarDokument, settAnalysererDokument] = useState(false);
    const [aktivChatId, setAktivChatId] = useState<string | null>(null);
    const [animerendeMeldingId, settAnimerendeMeldingId] = useState<string | null>(null);
    const [viserShareModal, setViserShareModal] = useState(false);
    const [viserExportModal, setViserExportModal] = useState(false);
    const [oppretterDeling, setOppretterDeling] = useState(false);
    const [kildePanelMeldingId, setKildePanelMeldingId] = useState<string | null>(null);
    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
    /** KI-feil fra reelt kall (chat/dokumentanalyse) – vises som banner; erstatter tidligere test-connection. */
    const [kiError, settKiError] = useState<Error | null>(null);

    const meldingsContainerRef = useRef<HTMLDivElement>(null);
    const meldingerSluttRef = useRef<HTMLDivElement>(null);
    const tekstInputRef = useRef<HTMLTextAreaElement>(null);
    const filInputRef = useRef<HTMLInputElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const sendMeldingRef = useRef<(options?: SendMeldingOptions) => Promise<void>>(async () => {});
    const meldingerRef = useRef<Melding[]>([]);
    /** Promise-basert mutex for chat-opprettelse. Holder Promise mens chat opprettes for å forhindre race conditions. */
    const oppretterChatPromiseRef = useRef<Promise<string | undefined> | null>(null);
    const isMountedRef = useRef(true);
    const retriedPendingSaveRef = useRef<string | null>(null);
    const brukerErVedBunnRef = useRef(true);
    /** Ref for animasjonsintervall — ryddes opp ved unmount eller ny melding. */
    const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /** AbortController for aktiv KI-forespørsel — brukes av stopp-knappen. */
    const chatAbortRef = useRef<AbortController | null>(null);
    /** Full tekst og melding-ID for pågående animasjon — brukes av stopp-knappen for å vise komplett svar. */
    const animatingFullTextRef = useRef<{ id: string; text: string } | null>(null);

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
        explanationLevel,
        selectedChatModel,
        setSelectedChatModel,
    } = useUIStore();
    // Zustand-selektorer: abonner kun på feltene vi faktisk bruker fra useKIStore.
    // Uten selektor re-rendrer ChatSection på ENHVER endring i storen (quiz-job-
    // status-poller, ukeplan, oppsummering, osv.) — selv om vi bare leser
    // runningChatId her. For en stor komponent som ChatSection gir dette merkbar
    // ekstra render-last når det finnes aktivitet på andre ki-features samtidig.
    const runningChatId = useKIStore((s) => s.runningChatId);
    const setRunningChatId = useKIStore((s) => s.setRunningChatId);

    /** Brukes for å vurdere om bruker spør om Canvas uten å ha valgt noe i innstillinger. */
    const harValgtCanvasData = canvasContextSelection.announcements ||
        canvasContextSelection.courses ||
        canvasContextSelection.assignments ||
        canvasContextSelection.events;
    const sisteNySamtaleToken = useRef(newChatToken);
    const { data: modelsData } = useKIModels();
    const modelOptions = [
        { id: "auto", name: t("chat.modelAuto") },
        ...((modelsData?.models ?? [])
            .filter((model) => ALLOWED_CHAT_MODEL_IDS.has(model.id))
            .map((model) => ({ id: model.id, name: model.name }))),
    ];
    const selectedModelLabel =
        modelOptions.find((model) => model.id === selectedChatModel)?.name ?? t("chat.modelAuto");
    const megQuery = useMeg();
    const kontoFornavn = hentKontoFornavn(megQuery.data?.user);
    const tomtilstandTittel = kontoFornavn
        ? t("chat.emptyStateTitleWithName", { name: kontoFornavn })
        : t("chat.emptyStateTitle");

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

    // Stuck-loader-redning ved re-mount under pågående strøm.
    //
    // Scenario: bruker sender melding → navigerer til /dashboard?view=admin →
    // kommer tilbake før svaret er ferdig. ChatSection unmountes og re-mountes,
    // men .then()/.catch()-closuren henger på den gamle komponentens
    // isMountedRef. Når strømmen fullfører blir zustand-runningChatId satt til
    // null (OK — synkroniseres over mount), men den nye komponentens lokale
    // skriver-state (satt via selectedChatId-effekten fra pendingConversationState)
    // forblir true fordi ingen .then() kjører på den nye komponenten. Resultat:
    // stop-knappen henger og meldings-useEffekten blokkeres av skriver-guarden
    // på linje 1416 → svaret fra chat-historikken vises ikke.
    //
    // Fix: når runningChatId går til null uten at vi har en aktiv lokal request
    // (chatAbortRef er null), og skriver fortsatt står true, rydd opp state
    // slik at chat-historikk-useEffekten kan kjøre og laste inn det persisterte
    // svaret. Uten dette måtte brukeren klikke Stop manuelt for å fortsette.
    useEffect(() => {
        if (runningChatId !== null) return;
        if (chatAbortRef.current) return;
        if (!skriver) return;
        settSkriver(false);
        settAnalysererDokument(false);
    }, [runningChatId, skriver]);

    useEffect(() => {
        const onDocumentClick = (event: MouseEvent) => {
            if (!modelMenuRef.current) return;
            if (!modelMenuRef.current.contains(event.target as Node)) {
                setIsModelMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocumentClick);
        return () => document.removeEventListener("mousedown", onDocumentClick);
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
        const container = meldingsContainerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
    }, []);

    // Scroll til bunn når innhold vokser, men bare hvis brukeren ikke har scrollet seg bort.
    useEffect(() => {
        if (!brukerErVedBunnRef.current) return;
        scrollTilBunn(skriver || analyserarDokument || animerendeMeldingId ? "auto" : "smooth");
    }, [meldinger, skriver, analyserarDokument, animerendeMeldingId, scrollTilBunn]);

    useEffect(() => {
        meldingerRef.current = meldinger;
    }, [meldinger]);

    const aktivChatIdRef = useRef(aktivChatId);
    useEffect(() => {
        aktivChatIdRef.current = aktivChatId;
    }, [aktivChatId]);

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
    const lagreSamtale = useCallback(async (oppdatert: Melding[], title?: string) => {
        const payload = oppdatert.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
            kilder: m.kilder,
        }));
        const chatId = aktivChatIdRef.current;
        if (chatId) {
            await saveChat(payload, chatId);
            return;
        }
        // Hvis en chat-opprettelse allerede pågår, vent på den og bruk resultatet
        if (oppretterChatPromiseRef.current) {
            const eksisterendeId = await oppretterChatPromiseRef.current;
            if (eksisterendeId) {
                await saveChat(payload, eksisterendeId);
            }
            return;
        }
        // Start ny chat-opprettelse med mutex
        const titleFromFirst = title ?? oppdatert.find((m) => m.rolle === "user")?.innhold?.trim().slice(0, 50) ?? t("chat.newConversationFallback");
        const createPromise = saveChat(payload, undefined, titleFromFirst).then((nyId) => {
            if (nyId) settAktivSamtale(nyId);
            return nyId;
        }).finally(() => {
            oppretterChatPromiseRef.current = null;
        });
        oppretterChatPromiseRef.current = createPromise;
        await createPromise;
    }, [saveChat, settAktivSamtale, t]);

    const harSammeMeldinger = (
        current: Array<{ rolle: "user" | "assistant"; innhold: string; kilder?: import("common/ki").KIChatSource[] }>,
        expected: Array<{ rolle: "user" | "assistant"; innhold: string; kilder?: import("common/ki").KIChatSource[] }>,
    ) => (
        current.length === expected.length &&
        current.every((melding, index) => (
            melding.rolle === expected[index]?.rolle &&
            melding.innhold === expected[index]?.innhold &&
            JSON.stringify(melding.kilder ?? []) === JSON.stringify(expected[index]?.kilder ?? [])
        ))
    );

    /** Oppdaterer pending state og sessionStorage med ny chat-id. Setter alltid runningChatId og currentChatId i store (så Sidebar viser pågående-markering også ved unmount); setter aktivChatId kun hvis komponenten er mountet. */
    const oppdaterPendingChatId = useCallback((requestId: string, chatId: string | undefined) => {
        if (!chatId) return;
        const requestErFortsattAktiv =
            pendingConversationState?.requestId === requestId ||
            pendingChatRef.current?.requestId === requestId;
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
        if (requestErFortsattAktiv) {
            try {
                sessionStorage?.setItem("studywise_last_chat_id", chatId);
            } catch {
                /* ignore */
            }
        }
        if (requestErFortsattAktiv && isMountedRef.current) {
            settAktivSamtale(chatId);
        }
    }, [setRunningChatId, setCurrentChatId, settAktivSamtale]);

    /** Rydder opp lokal/global pending-state når brukeren avbryter en pågående chatforespørsel. */
    const avbrytAktivChatForesporsel = useCallback((
        options: {
            requestId?: string;
            userMessageId?: string;
        } = {},
    ) => {
        const aktivPending = pendingChatRef.current;
        const requestId = options.requestId ?? aktivPending?.requestId;
        const userMessageId = options.userMessageId ?? aktivPending?.userMessage.id;

        chatAbortRef.current = null;
        animatingFullTextRef.current = null;
        stoppAktivAnimasjon();

        if (!requestId || aktivPending?.requestId === requestId) {
            pendingChatRef.current = null;
        }
        if (requestId && pendingConversationState?.requestId === requestId) {
            pendingConversationState = null;
        }

        setRunningChatId(null);

        try {
            sessionStorage?.removeItem("studywise_last_chat_id");
        } catch {
            /* ignore */
        }

        if (!isMountedRef.current) return;

        settSkriver(false);
        if (!userMessageId) return;

        settMeldinger((prev) => {
            const neste = prev.filter((m) => m.id !== userMessageId);
            meldingerRef.current = neste;
            return neste;
        });
    }, [setRunningChatId, stoppAktivAnimasjon]);

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
            kilder: m.kilder,
        }));
        const sameChat = pending.chatId ? aktivChatId === pending.chatId : true;
        const currentMessages = meldingerRef.current.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
            kilder: m.kilder,
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
            kilder: m.kilder,
        }));
        const expectedMessages = [
            ...pending.messagesBefore,
            pending.userMessage,
            ...(pending.assistantMessage ? [pending.assistantMessage] : []),
        ].map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
            kilder: m.kilder,
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
            kilder: m.kilder,
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
            kilder: m.kilder,
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
    const nySamtale = useCallback(async () => {
        const gjeldendeMeldinger = meldingerRef.current;
        if (gjeldendeMeldinger.length > 0) {
            void lagreSamtale(gjeldendeMeldinger).catch(() => {
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
    }, [lagreSamtale, stoppAktivAnimasjon, t, setRunningChatId, settMeldinger, settAktivSamtale, settVedlegg, settSkriver, settAnalysererDokument]);

    /** Reagerer på "Ny samtale"-knapp i sidebar: nullstiller og starter ny samtale. */
    useEffect(() => {
        if (sisteNySamtaleToken.current === newChatToken) return;
        sisteNySamtaleToken.current = newChatToken;
        void nySamtale();
    }, [newChatToken, nySamtale]);

    /** Validerer filstørrelse (max 15 MB), viser toast ved for mange, setter ett vedlegg. */
    const håndterFiler = useCallback((filer: File[]) => {
        if (filer.length === 0) return;

        const godkjente: File[] = [];
        for (const fil of filer) {
            if (fil.size > 15 * 1024 * 1024) {
                const feilMelding: Melding = {
                    id: Date.now().toString(),
                    rolle: "assistant",
                    innhold: t("chat.fileTooLarge", { name: fil.name }),
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
    }, [vedlegg.length, t]);

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
     * Animerer assistent-svar paragraf-for-paragraf for raskere, mer lesbar progresjon.
     */
    const animerTekst = useCallback(
        (id: string, fullText: string, onDone: () => void) => {
            stoppAktivAnimasjon();
            settAnimerendeMeldingId(id);
            const paragraphs = fullText
                .split(/(\n{2,})/)
                .filter((segment) => segment.length > 0);
            const chunks = paragraphs.length > 0 ? paragraphs : [fullText];
            let index = 0;
            // 60ms intervall gir browseren ~3 frames per chunk-append, som er
            // nok til å male uten at animasjonen føles treig. Lavere verdier
            // (f.eks. 35ms) overwhelmer markdown-reparsingen (ReactMarkdown +
            // KaTeX + sanitize) og får streamingen til å føles choppy.
            animationIntervalRef.current = setInterval(() => {
                index = Math.min(index + 1, chunks.length);
                settMeldinger((prev) =>
                    prev.map((m) =>
                        m.id === id ? { ...m, innhold: chunks.slice(0, index).join("") } : m,
                    ),
                );
                if (index >= chunks.length) {
                    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
                    animationIntervalRef.current = null;
                    settAnimerendeMeldingId(null);
                    onDone();
                }
            }, 60);
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
        const brukerMeldingInnhold = trimmetTekst || (harVedlegg ? t("chat.analyzeDocumentFallback", { name: vedlagtNavn }) : "");
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
        meldingerRef.current = [...meldingerRef.current, brukerMelding];

        /* Vedlegg: opprett chat om nødvendig, sett pending (document), kjør dokumentanalyse og lagre i onSuccess/onError. */
        if (harVedlegg) {
            settAnalysererDokument(true);
            const filTilAnalyse = vedlegg[0];
            settVedlegg([]);
            const titleFromFirst = brukerMeldingInnhold.trim().slice(0, 50) || t("chat.newConversationFallback");
            const requestId = createPendingRequestId();
            docAnalysisChatIdRef.current = aktivChatId;
            const messagesBeforeForSave = [...meldinger, brukerMelding].map((m) => ({
                rolle: m.rolle as "user" | "assistant",
                innhold: m.innhold,
                kilder: m.kilder,
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
                    [{ rolle: "user" as const, innhold: brukerMeldingInnhold, kilder: undefined }],
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
                payload: Array<{ rolle: "user" | "assistant"; innhold: string; kilder?: import("common/ki").KIChatSource[] }>,
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

            analyserDokument(filTilAnalyse, brukerMeldingInnhold || t("chat.summarizeDocumentFallback"), {
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
                manglerData.push(t("chat.canvasDataAnnouncements"));
            }
            if (spørOmEmner && !canvasContextSelection.courses) {
                manglerData.push(t("chat.canvasDataCourses"));
            }
            if (spørOmOppgaver && !canvasContextSelection.assignments) {
                manglerData.push(t("chat.canvasDataAssignments"));
            }
            if (spørOmHendelser && !canvasContextSelection.events) {
                manglerData.push(t("chat.canvasDataEvents"));
            }

            // Hvis brukeren ikke har valgt noen Canvas-data i innstillinger
            if (!harValgtCanvasData) {
                const systemMelding: Melding = {
                    id: (Date.now() + 1).toString(),
                    rolle: "assistant",
                    innhold: t("chat.noCanvasDataSelected"),
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
                    innhold: t("chat.missingCanvasData", {
                        missing: manglerData.join(t("chat.missingCanvasDataJoinOr")).toLowerCase(),
                        activate: manglerData.join(t("chat.missingCanvasDataJoinAnd")),
                    }),
                    tidsstempel: new Date(),
                };
                settMeldinger((tidligere) => [...tidligere, systemMelding]);
                return;
            }
        }

        // Canvas-validering passert — nå kan vi sette pending state og opprette chat
        settSkriver(true);

        const titleFromFirst = brukerMeldingInnhold.trim().slice(0, 50) || t("chat.newConversationFallback");
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
                [{ rolle: "user" as const, innhold: brukerMeldingInnhold, kilder: undefined }],
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

        const abortController = new AbortController();
        chatAbortRef.current = abortController;

        void streamKIChat(apiMeldinger, {
            explanationLevel,
            model: selectedChatModel,
            signal: abortController.signal,
            // Send chat-ID slik at backend kan skope session-state (courseHint-lås,
            // aktiv kunnskapsbase, kontekst-cache) per chat i stedet for per bruker.
            // Uten dette kan to chatter som åpnet med samme spørsmål ("Hvilke emner
            // er jeg registrert på?") dele lås og krysskontaminere hverandre.
            ...(aktivChatIdRef.current && { chatId: aktivChatIdRef.current }),
        })
            .then((data) => {
                chatAbortRef.current = null;
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
                    kilder: data.kilder && data.kilder.length > 0 ? data.kilder : undefined,
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
                    animatingFullTextRef.current = { id: assistantId, text: responseText };
                    animerTekst(assistantId, responseText, () => {
                        animatingFullTextRef.current = null;
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
                chatAbortRef.current = null;
                // Bruker avbrøt manuelt — fjern brukerens melding og reset
                if (abortController.signal.aborted) {
                    avbrytAktivChatForesporsel({
                        requestId,
                        userMessageId: brukerMelding.id,
                    });
                    return;
                }
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
        // Bail kun når animasjonen faktisk peker på en eksisterende boble; ellers skal vi få lov til å reset-e skriver.
        if (animerendeMeldingId && meldinger.some((m) => m.id === animerendeMeldingId)) return;
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
                    kilder: m.kilder,
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
            // Defensiv guard: ikke wipe en pågående sending. Hvis vi skriver eller har en aktiv pending
            // (f.eks. ny chat hvor saveChat akkurat har resolvet og aktivChatId nettopp ble satt før
            // chats-cachen er oppdatert), la meldingene stå urørt — ellers kan brukerboblen forsvinne
            // mens stop-knappen fortsatt vises.
            if (skriver || pendingChatRef.current || pendingConversationState) return;
            if (meldingerRef.current.length > 0) return;

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
            kilder: m.kilder,
        }));
        const savedMessages = chat.messages.map((m) => ({
            rolle: m.rolle,
            innhold: m.innhold,
            kilder: m.kilder,
        }));
        if (harSammeMeldinger(currentMessages, savedMessages)) return;

        // Defensiv guard: ikke overskriv lokale optimistiske meldinger med en kortere cache-snapshot.
        // Dette kan skje når brukeren nettopp har sendt en melding mot en eksisterende chat og
        // cachen ennå ikke er oppdatert med den nye user-bubblen — uten denne sjekken ville
        // user-bubblen forsvinne mens skriver fortsatt er true.
        // Vi blokkerer ALL cache-overskriving når skriver/pending er aktiv, uansett retning,
        // for å hindre at en stale snapshot tømmer meldinger mens en send er underveis.
        if (skriver || pendingChatRef.current || pendingConversationState?.chatId === aktivChatId) return;

        settMeldinger(chat.messages.map((m, i) => ({
            id: `${Date.now()}-${i}`,
            rolle: m.rolle,
            innhold: m.innhold,
            tidsstempel: new Date(),
            kilder: m.kilder,
        })));
    }, [aktivChatId, chats, loadChatById, loading, animerendeMeldingId, setSelectedChatId, settAktivSamtale, stoppAktivAnimasjon, skriver]);

    const sisteAssistentsvar =
        [...meldinger].reverse().find((melding) => melding.rolle === "assistant")?.innhold ?? "";
    const delingsTittel =
        aktivChat?.title?.trim() ||
        meldinger.find((melding) => melding.rolle === "user")?.innhold?.trim().slice(0, 50) ||
        t("chat.conversationFallback");
    const panelMelding = kildePanelMeldingId
        ? meldinger.find((melding) => melding.id === kildePanelMeldingId && melding.rolle === "assistant")
        : null;
    const panelKilder = useMemo<import("common/ki").KIChatSource[]>(
        () => (panelMelding ? hentVisbareKilder(panelMelding) : []),
        [panelMelding],
    );
    const visKildePanel = !!panelMelding;

    const handleKildeKlikk = useCallback((kilde: import("common/ki").KIChatSource) => {
        const harSourceUrl =
            typeof kilde.sourceUrl === "string" && isSafeExternalUrl(kilde.sourceUrl);
        // Foretrekk sourceUrl når den finnes. Ekte Canvas-filer har aldri
        // sourceUrl satt — feltet fylles kun for crawlet eksternt innhold
        // (PDFer og sider hentet fra f.eks. windowsnett.no). Å prøve Canvas-
        // nedlasting først for crawlede kilder er bortkastet: endepunktet
        // returnerer alltid 404 siden fileId er syntetisk.
        if (harSourceUrl) {
            window.open(kilde.sourceUrl!, "_blank", "noopener,noreferrer");
            return;
        }
        if (Number.isFinite(kilde.fileId)) {
            void downloadAuthedFile(
                `/api/canvas/filer/${kilde.fileId}/download`,
                visFilnavn(kilde.fileName),
            ).catch(() => {
                showToast.error(t("chat.sourceDownloadFailed"));
            });
            return;
        }
        // kb_file: originalfilen lagres ikke — vis info om at det er indeksert innhold
        if (kilde.sourceKind === "kb_file") {
            showToast.info(t("chat.sourceKbFileInfo"));
            return;
        }
        showToast.error(t("chat.sourceDownloadFailed"));
    }, [t]);

    const renderKildeListe = useCallback((keySuffix = "") => (
        <>
            {panelKilder.length === 0 && (
                <p className="px-1 text-sm text-slate-500 dark:text-slate-400">
                    {t("chat.noSourcesForAnswer")}
                </p>
            )}
            {panelKilder.map((kilde) => (
                <button
                    type="button"
                    key={`${kilde.sourceKind ?? "canvas_file"}:${kilde.courseId}:${kilde.fileId ?? "na"}:${kilde.fileName}:${kilde.sourceUrl ?? ""}${keySuffix}`}
                    onClick={() => handleKildeKlikk(kilde)}
                    title={`${kilde.courseName} – ${visFilnavn(kilde.fileName)}`}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/70"
                >
                    <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white wrap-break-word">
                                {visFilnavn(kilde.fileName)}
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {kilde.courseName}
                            </p>
                        </div>
                    </div>
                </button>
            ))}
        </>
    ), [handleKildeKlikk, panelKilder, t]);

    const opprettDelingslenke = useCallback(async () => {
        if (oppretterDeling) return null;
        setOppretterDeling(true);
        try {
            let chatId = aktivChatId;

            if (!chatId && meldingerRef.current.length > 0) {
                const titleFromFirst =
                    meldingerRef.current.find((melding) => melding.rolle === "user")?.innhold?.trim().slice(0, 50) ||
                    t("chat.newConversationFallback");
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
                body: JSON.stringify({}),
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
        <div className="h-full flex min-h-0 overflow-hidden">
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
            <ChatExportModal
                isOpen={viserExportModal}
                onClose={() => setViserExportModal(false)}
                chatTitle={delingsTittel}
                messageCount={meldinger.length}
                content={meldinger.map((m) => {
                    const rolle = m.rolle === "user" ? "**Deg**" : "🤖 **KI-Assistent**";
                    const innhold = m.rolle === "assistant"
                        ? appendKilderToMarkdown(m.innhold, m.kilder, t("chat.sourcesHeading"))
                        : m.innhold;
                    return `### ${rolle}\n\n${innhold}`;
                }).join("\n\n---\n\n")}
            />
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                {/* Meldinger */}
                <div
                    ref={meldingsContainerRef}
                    onScroll={oppdaterBrukerScrollPosisjon}
                    className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0"
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
                                    {t("chat.retryButton")}
                                </button>
                                {visKiFeilDetaljer && kiError && (
                                    <details className="w-full max-w-235">
                                        <summary className="cursor-pointer text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                                            {t("chat.showErrorDetails")}
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

                    {/* Tomme meldinger - vis forslag (kun etter mount og når ikke loading; ikke under pågående svar) */}
                    {mounted && !loading && meldinger.length === 0 && !skriver && !analyserarDokument && (
                        <div className="space-y-4">
                            <div className="text-center py-12">
                                <Bot className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                                    {tomtilstandTittel}
                                </h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {t("chat.emptyStateSubtitle")}
                                </p>
                            </div>

                            {/* Forslag */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                                {forslag.map((forslagTekst) => (
                                    <button
                                        key={forslagTekst}
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
                    {meldinger.map((melding, meldingIdx) => (
                        (() => {
                            const visbareKilder = melding.rolle === "assistant" ? hentVisbareKilder(melding) : [];
                            const harKilder = visbareKilder.length > 0;
                            return (
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
                                            {t("chat.retryButton")}
                                        </button>
                                        <span className="text-xs text-red-500 dark:text-red-400">{t("chat.sendingFailed")}</span>
                                    </div>
                                )}

                                {/* Handlingsknapper under AI-svar */}
                                {melding.rolle === "assistant" && animerendeMeldingId !== melding.id && !skriver && (
                                    <div className="flex items-center mt-1.5 px-0.5">
                                        <div className="flex items-center gap-0.5">
                                            {harKilder && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setKildePanelMeldingId((prev) => prev === melding.id ? null : melding.id);
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                                                title={`${t("chat.sources")} (${visbareKilder.length})`}
                                                aria-pressed={kildePanelMeldingId === melding.id}
                                            >
                                                <span className="inline-flex items-center -space-x-1">
                                                    <span className="w-3.5 h-3.5 rounded-full bg-red-400 border border-white/80" />
                                                    <span className="w-3.5 h-3.5 rounded-full bg-yellow-400 border border-white/80" />
                                                    <span className="w-3.5 h-3.5 rounded-full bg-blue-400 border border-white/80" />
                                                </span>
                                                <span>{visbareKilder.length} {t("chat.sourcesPillLabel")}</span>
                                            </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        const tekst = appendKilderToMarkdown(
                                                            melding.innhold,
                                                            melding.kilder,
                                                            t("chat.sourcesHeading"),
                                                        );
                                                        await navigator.clipboard.writeText(tekst);
                                                        showToast.success(t("chat.copiedToClipboard"));
                                                    } catch {
                                                        showToast.error(t("chat.couldNotCopy"));
                                                    }
                                                }}
                                                className={actionBtnClass}
                                                title={t("chat.copyButton")}
                                                aria-label={t("chat.copyButton")}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            {(["up", "down"] as const).map((rating) => {
                                                const aktiv = feedbackMap[melding.id] === rating;
                                                const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
                                                const aktivKlasse = aktiv
                                                    ? rating === "up"
                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 ring-1 ring-green-400 dark:ring-green-600"
                                                        : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-400 dark:ring-red-600"
                                                    : "";
                                                return (
                                                    <button
                                                        key={rating}
                                                        type="button"
                                                        onClick={async () => {
                                                            const forrige = meldinger[meldingIdx - 1];
                                                            const sporsmal = forrige?.rolle === "user" ? forrige.innhold : undefined;
                                                            settFeedbackMap((prev) => ({ ...prev, [melding.id]: rating }));
                                                            try {
                                                                const r = await fetchApi("/api/ki/feedback", {
                                                                    method: "POST",
                                                                    headers: { "Content-Type": "application/json" },
                                                                    body: JSON.stringify({
                                                                        messageId: melding.id,
                                                                        rating,
                                                                        question: sporsmal?.slice(0, 2000),
                                                                        answer: melding.innhold.slice(0, 5000),
                                                                    }),
                                                                });
                                                                if (!r.ok) throw new Error("feedback");
                                                                showToast.success(rating === "up" ? t("chat.feedbackThanksGood") : t("chat.feedbackThanksBad"));
                                                            } catch {
                                                                settFeedbackMap((prev) => {
                                                                    const next = { ...prev };
                                                                    delete next[melding.id];
                                                                    return next;
                                                                });
                                                                showToast.error(t("chat.feedbackFailed"));
                                                            }
                                                        }}
                                                        className={`${actionBtnClass} ${aktivKlasse}`}
                                                        title={rating === "up" ? t("chat.feedbackGood") : t("chat.feedbackBad")}
                                                        aria-label={rating === "up" ? t("chat.feedbackGood") : t("chat.feedbackBad")}
                                                        aria-pressed={aktiv}
                                                    >
                                                        <Icon className={`w-4 h-4 ${aktiv ? "fill-current" : ""}`} />
                                                    </button>
                                                );
                                            })}
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
                            );
                        })()
                    ))}

                    {/* Skriver indikator — vis også når animerendeMeldingId peker på en boble som ikke lenger finnes
                        i meldinger (kan skje ved chat-bytte/cache-race), ellers blir skjermen helt tom. */}
                    {((skriver && (!animerendeMeldingId || !meldinger.some((m) => m.id === animerendeMeldingId && m.innhold.length > 0))) || analyserarDokument) && (
                        <div className="flex items-start gap-3 justify-start" role="status" aria-live="polite">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                                <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="py-3 flex flex-col gap-2">
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
                                        <span className="sr-only">{t("chat.typingIndicator")}</span>
                                    </div>
                                )}
                                <RotatingStatusMessage active={skriver || analyserarDokument} />
                            </div>
                        </div>
                    )}

                    <div ref={meldingerSluttRef} />
                  </div>
                </div>

                {/* Smart suggestions - reserver høyde for å hindre at input flytter seg */}
                <div className="shrink-0 min-h-13">
                    {meldinger.length > 0 && !skriver && !analyserarDokument && sisteAssistentsvar && (
                        <SmartSuggestions
                            lastAIMessage={sisteAssistentsvar}
                            onSelectSuggestion={(suggestion) => {
                                settTekstInput(suggestion);
                                tekstInputRef.current?.focus();
                            }}
                        />
                    )}
                </div>

                {/* Input */}
                <div className="shrink-0 px-4 md:px-6 pb-4 pt-3">
                  <div className="max-w-235 mx-auto">
                    {/* Vedleggsliste (kompakt stripe) */}
                    <AttachmentStrip vedlegg={vedlegg} onFjern={fjernVedlegg} />
                    
                    <div className="chat-input-shell flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus-within:border-slate-200 dark:focus-within:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 focus-within:outline-none focus-within:ring-0">
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
                            className="chat-input-icon-btn shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hidden sm:flex items-center justify-center transition-colors"
                            title={t("chat.shareConversationTitle")}
                            aria-label={t("chat.shareConversation")}
                        >
                            <Share2 className="chat-input-icon w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>

                        {/* Eksporter samtale */}
                        <button
                            type="button"
                            onClick={() => setViserExportModal(true)}
                            disabled={meldinger.length === 0 || skriver || analyserarDokument}
                            className="chat-input-icon-btn shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hidden sm:flex items-center justify-center transition-colors"
                            title={t("exportModal.title")}
                            aria-label={t("exportModal.title")}
                        >
                            <Upload className="chat-input-icon w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>

                        {/* Filopplasting */}
                        <button
                            type="button"
                            onClick={() => filInputRef.current?.click()}
                            disabled={skriver || analyserarDokument}
                            className="chat-input-icon-btn shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            title={t("chat.uploadDocumentLabel")}
                            aria-label={t("chat.uploadDocumentAriaLabel")}
                        >
                            <Plus className="chat-input-icon w-5 h-5 text-slate-400 dark:text-slate-500" />
                        </button>

                        <textarea
                            ref={tekstInputRef}
                            value={tekstInput}
                            onChange={(e) => settTekstInput(e.target.value)}
                            onKeyDown={handterTastetrykk}
                            placeholder={vedlegg.length > 0 ? t("chat.placeholderAttachment") : t("chat.placeholderDefault")}
                            aria-label={t("chat.inputAriaLabel")}
                            disabled={skriver || analyserarDokument}
                            rows={1}
                            className="chat-input-textarea flex-1 min-w-0 resize-none bg-transparent py-2 text-base sm:text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 border-none shadow-none disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                            style={{ outline: "none" }}
                        />
                        <div ref={modelMenuRef} className="relative shrink-0">
                            <button
                                type="button"
                                onClick={() => setIsModelMenuOpen((prev) => !prev)}
                                className="h-8 max-w-30 sm:max-w-45 truncate rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 sm:px-3 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                title={t("chat.modelSelectorTooltip")}
                                aria-label={t("chat.modelSelectorLabel")}
                                aria-expanded={isModelMenuOpen}
                                aria-haspopup="listbox"
                            >
                                {selectedModelLabel}
                            </button>
                            {isModelMenuOpen && (
                                <div className="absolute right-0 bottom-full mb-2 w-56 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl z-20">
                                    {modelOptions.map((model) => {
                                        const isSelected = model.id === selectedChatModel;
                                        return (
                                            <button
                                                key={model.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedChatModel(model.id);
                                                    setIsModelMenuOpen(false);
                                                }}
                                                className={`w-full text-left rounded-xl px-3 py-2 text-sm transition-colors ${
                                                    isSelected
                                                        ? "bg-blue-600 text-white"
                                                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                }`}
                                            >
                                                {model.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {skriver ? (
                            <button
                                type="button"
                                onClick={() => {
                                    if (chatAbortRef.current) {
                                        const aktivPending = pendingChatRef.current;
                                        chatAbortRef.current.abort();
                                        avbrytAktivChatForesporsel({
                                            requestId: aktivPending?.requestId,
                                            userMessageId: aktivPending?.userMessage.id,
                                        });
                                        return;
                                    }

                                    stoppAktivAnimasjon();
                                    // Vis komplett tekst umiddelbart hvis animasjonen ble stoppet (svar allerede mottatt)
                                    const pending = animatingFullTextRef.current;
                                    if (pending) {
                                        settMeldinger((prev) =>
                                            prev.map((m) =>
                                                m.id === pending.id ? { ...m, innhold: pending.text } : m,
                                            ),
                                        );
                                        animatingFullTextRef.current = null;
                                    }
                                    settSkriver(false);
                                }}
                                className="chat-input-icon-btn shrink-0 w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center transition-colors"
                                aria-label={t("common.actions.cancel")}
                            >
                                <Square className="chat-input-icon w-3.5 h-3.5 text-slate-600 dark:text-slate-300 fill-current" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    void sendMelding();
                                }}
                                disabled={(!tekstInput.trim() && vedlegg.length === 0) || analyserarDokument}
                                className="chat-input-icon-btn shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                                aria-label={t("chat.sendMessage")}
                            >
                                <Send className="chat-input-icon w-4 h-4 text-slate-400 dark:text-slate-500" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center justify-between mt-2 px-1">
                        <div className="flex items-center gap-1">
                            <GraduationCap className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            <div className="flex gap-0.5">
                                {(["simple", "standard", "detailed", "expert"] as const).map((level) => {
                                    const label = t(`chat.explanationLevel.${level}`);
                                    return (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => useUIStore.getState().setExplanationLevel(level)}
                                            className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                                                explanationLevel === level
                                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium"
                                                    : "text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                                            }`}
                                            title={t("chat.explanationLevel.tooltip", { level: label })}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="hidden md:block text-xs text-slate-400 dark:text-slate-500">
                            {t("chat.inputHint")}
                        </p>
                    </div>
                  </div>
                </div>
            </div>

            {visKildePanel && (
                <aside className="hidden lg:flex w-90 shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-0 flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {t("chat.sources")} ({panelKilder.length})
                        </p>
                        <button
                            type="button"
                            onClick={() => setKildePanelMeldingId(null)}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                            aria-label={t("common.actions.close")}
                        >
                            ×
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {renderKildeListe()}
                    </div>
                </aside>
            )}
            {visKildePanel && (
                <div
                    className="lg:hidden fixed inset-0 z-50"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t("chat.sources")}
                >
                    {/* Scrim — chat synlig under */}
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setKildePanelMeldingId(null)}
                        aria-label={t("common.actions.close")}
                        tabIndex={-1}
                    />
                    {/* Top-sheet: slipper ned fra toppen, maks ~70vh, resten er scrim */}
                    <div
                        className="absolute top-0 left-0 right-0 max-h-[70vh] rounded-b-2xl border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg flex flex-col"
                        style={{ paddingTop: "env(safe-area-inset-top)" }}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
                            <p className="text-base font-semibold text-slate-900 dark:text-white">
                                {t("chat.sources")} ({panelKilder.length})
                            </p>
                            <button
                                type="button"
                                onClick={() => setKildePanelMeldingId(null)}
                                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
                                aria-label={t("common.actions.close")}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="overflow-y-auto p-3 space-y-2">
                            {renderKildeListe(":mobile")}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

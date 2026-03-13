/*
 * SettingsSection - Brukerinnstillinger
 * Håndterer tema, Canvas-token, AI-kontekst og andre preferanser
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Moon, Sun, Key, User, Info, Trash2, MessageSquare, Bot, CheckCircle, Shield, ExternalLink } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { AUTH_ME_QUERY_KEY, CanvasTokenConflictError, useLagreCanvasToken, useSlettCanvasToken, useSlettKonto } from "@/app/auth/auth-api";
import { resetCanvasTokenStatus, useCanvasUser } from "@/app/canvas/canvas-api";
import { useTheme } from "next-themes";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";
import { showToast } from "@/app/components/ui/Toaster";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { CanvasContextSelector } from "@/app/components/canvas/CanvasContextSelector";
import { CANVAS_INSTITUSJONER_NORGE } from "common/canvasInstitutions";
import { CanvasBaseUrlSchema } from "common/auth";

// Typer for SettingsSection props
interface SettingsSectionProps {
    harCanvasToken?: boolean;
    lokalBrukerEpost?: string;
    /** Nåværende Canvas base URL for brukerens institusjon (fra /me). */
    canvasBaseUrl?: string | null;
}

function getAvatarInitialer(value: string | null | undefined): string {
    const cleaned = value?.trim();
    if (!cleaned) return "SW";

    const parts = cleaned
        .split(/[\s@._-]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 2);

    if (parts.length === 0) {
        return cleaned.slice(0, 2).toUpperCase();
    }

    return parts
        .map((part) => part.charAt(0).toUpperCase())
        .join("")
        .slice(0, 2);
}

function getSafeAvatarUrl(url: string | undefined): string | null {
    if (!url || !url.startsWith("https://")) {
        return null;
    }
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        const allowed =
            hostname === "instructure-uploads.s3.amazonaws.com" ||
            hostname.endsWith(".instructure.com") ||
            hostname === "instructure.com";
        return allowed ? url : null;
    } catch {
        return null;
    }
}

function ProfileAvatar({
    imageUrl,
    label,
    alt,
    tone,
}: {
    imageUrl?: string | null;
    label?: string | null;
    alt: string;
    tone: "blue" | "green";
}) {
    const toneClasses = tone === "blue"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200";

    if (imageUrl) {
        return (
            <img
                src={imageUrl}
                alt={alt}
                className="w-12 h-12 rounded-full object-cover bg-slate-200 dark:bg-slate-700"
            />
        );
    }

    return (
        <div
            role="img"
            aria-label={alt}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold ${toneClasses}`}
        >
            {getAvatarInitialer(label)}
        </div>
    );
}
// Settings seksjon komponent
export function SettingsSection({
    harCanvasToken,
    lokalBrukerEpost,
    canvasBaseUrl: brukerCanvasBaseUrl,
}: SettingsSectionProps) {
    const clerk = useClerk();
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Sett mounted til true etter første render
    useEffect(() => {
        setMounted(true);
    }, []);

    // Bestem om mørk modus er aktiv
    const isDarkMode = mounted && resolvedTheme === "dark";
    const toggleTheme = () => setTheme(isDarkMode ? "light" : "dark");
    const queryClient = useQueryClient();
    const [canvasToken, setCanvasToken] = useState("");
    const [canvasKonflikt, setCanvasKonflikt] = useState<{
        token: string;
        melding: string;
    } | null>(null);
    const [visToken, setVisToken] = useState(false);
    const {
        mutateAsync,
        isPending,
    } = useLagreCanvasToken();

    const {
        mutateAsync: slettToken,
        isPending: isSlettingToken,
    } = useSlettCanvasToken();
    const {
        mutateAsync: slettKonto,
        isPending: isSlettingKonto,
    } = useSlettKonto();

    const [visSlettBekreftelse, setVisSlettBekreftelse] = useState(false);
    const [visKontoSletting, setVisKontoSletting] = useState(false);
    const [kontoSlettBekreftelse, setKontoSlettBekreftelse] = useState("");

    const [cooldown, setCooldown] = useState(false);
    const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Multi-tenant: velg institusjon ved lagring av token
    const [valgtInstitusjonUrl, setValgtInstitusjonUrl] = useState<string>("");
    const [annenCanvasUrl, setAnnenCanvasUrl] = useState("");
    const { clearAll: clearChatHistory, chats, loading: chatsLoading } = useChatHistory();

    useEffect(() => {
        return () => {
            if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (!brukerCanvasBaseUrl) return;
        const kjentInstitusjon = CANVAS_INSTITUSJONER_NORGE.find(
            (inst) => inst.url === brukerCanvasBaseUrl,
        );
        setValgtInstitusjonUrl(kjentInstitusjon ? kjentInstitusjon.url : "other");
        setAnnenCanvasUrl(kjentInstitusjon ? "" : brukerCanvasBaseUrl);
    }, [brukerCanvasBaseUrl]);

    // Hent Canvas-brukerdata for profil-visning
    const canvasUserQuery = useCanvasUser(harCanvasToken);
    const canvasUser = canvasUserQuery.data;

    // Formater opprettelsesdato hvis tilgjengelig
    const opprettetDato = canvasUser?.created_at
        ? format(new Date(canvasUser.created_at), "d. MMMM yyyy", { locale: nb })
        : null;

    // Håndter lagring av Canvas token
    const handleLagreToken = async (forceRelink = false) => {
        if (cooldown) return;
        const trimmetToken = (forceRelink ? canvasKonflikt?.token : canvasToken)?.trim();
        if (!trimmetToken) return;
        const valgtCanvasBaseUrl = valgtInstitusjonUrl === "other"
            ? annenCanvasUrl.trim()
            : valgtInstitusjonUrl;
        if (!valgtCanvasBaseUrl) {
            showToast.error("Velg institusjon", "Velg en Canvas-institusjon før du lagrer tokenet.");
            return;
        }
        const parsedCanvasBaseUrl = CanvasBaseUrlSchema.safeParse(valgtCanvasBaseUrl);
        if (!parsedCanvasBaseUrl.success) {
            showToast.error(
                "Ugyldig Canvas-URL",
                parsedCanvasBaseUrl.error.issues[0]?.message || "Skriv inn en gyldig Canvas-instans.",
            );
            return;
        }
        try {
            await mutateAsync({
                token: trimmetToken,
                forceRelink,
                canvasBaseUrl: parsedCanvasBaseUrl.data,
            });
            setCanvasToken("");
            setCanvasKonflikt(null);
            // Nullstill token-feilstatus slik at Canvas-queries aktiveres igjen
            resetCanvasTokenStatus();
            // Invalidér queries for å hente data på nytt
            queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ["canvas"] });
            showToast.success("Canvas-token lagret", "Canvas-data blir tilgjengelig om kort tid.");
            // Sett cooldown for å hindre spamming (clear ved unmount)
            setCooldown(true);
            if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
            cooldownTimeoutRef.current = setTimeout(() => setCooldown(false), 3000);
        } catch (err) {
            if (err instanceof CanvasTokenConflictError) {
                setCanvasKonflikt({
                    token: trimmetToken,
                    melding: err.message,
                });
                showToast.warning(
                    "Canvas-kontoen er allerede koblet",
                    "Hvis dette er din konto, kan du gjenopprette tilkoblingen her.",
                );
                return;
            }
            const feilmelding = lagBrukervennligFeilmelding(err instanceof Error ? err : null, { canvas: true });
            showToast.error("Kunne ikke lagre token", feilmelding);
        }
    };

    // Håndter sletting av Canvas token
    const handleSlettToken = async () => {
        try {
            await slettToken();
            setVisSlettBekreftelse(false);
            setCanvasKonflikt(null);
            // Invalidér queries for å oppdatere UI
            queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ["canvas"] });
            showToast.success("Canvas-token slettet", "Canvas-tilkoblingen er fjernet.");
        } catch (err) {
            const feilmelding = lagBrukervennligFeilmelding(err instanceof Error ? err : null, { canvas: true });
            showToast.error("Kunne ikke slette token", feilmelding);
        }
    };

    const handleSlettKonto = async () => {
        const fullforLokalUtlogging = () => {
            broadcastLogout();
            clearClientAuthState(queryClient);
            window.location.assign("/");
        };

        try {
            const result = await slettKonto();

            if (result.providerAccountDeleted) {
                showToast.success("Konto slettet", "StudyWise-kontoen og tilknyttet data er slettet.");
            } else {
                showToast.warning(
                    "StudyWise-konto slettet",
                    "Dataene er slettet, men innloggingskontoen kunne ikke fjernes automatisk. Vi logger deg ut nå.",
                );
            }

            // Alltid signOut fra Clerk slik at lokal sesjon fjernes og vi unngår 401-flyt på neste side lasting
            try {
                await clerk.signOut();
            } catch {
                showToast.error(
                    "Manuell utlogging kreves",
                    "StudyWise-dataene er slettet, men vi klarte ikke å avslutte innloggingssesjonen automatisk.",
                );
                return;
            }

            fullforLokalUtlogging();
        } catch (err) {
            const feilmelding = lagBrukervennligFeilmelding(err instanceof Error ? err : null, {}, "Prøv igjen.");
            showToast.error("Kunne ikke slette konto", feilmelding);
        }
    };

    const manglerCanvasUrl =
        !valgtInstitusjonUrl ||
        (valgtInstitusjonUrl === "other" && !annenCanvasUrl.trim());

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Innstillinger
                </h2>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 flex justify-center">
                <div className="max-w-4xl w-full space-y-8">
                    {/* Brukerinformasjon */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <User size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Profil
                            </h3>
                        </div>

                        <div className="space-y-4">
                            {/* Lokal StudyWise-konto */}
                            <div className="flex items-center gap-4">
                                <ProfileAvatar
                                    label={lokalBrukerEpost}
                                    alt="Profilbilde for StudyWise-konto"
                                    tone="blue"
                                />
                                <div>
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                        StudyWise-konto
                                    </p>
                                    <p className="font-medium text-slate-900 dark:text-white">
                                        {lokalBrukerEpost || "Ikke innlogget"}
                                    </p>
                                </div>
                            </div>

                            {/* Skillelinje */}
                            <div className="border-t border-slate-100 dark:border-slate-700" />

                            {/* Canvas-tilkobling */}
                            <div>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                                    Canvas-tilkobling
                                </p>
                                {canvasUserQuery.isLoading ? (
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="space-y-2">
                                            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                                            <div className="h-3 w-48 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                                        </div>
                                    </div>
                                ) : harCanvasToken && canvasUser ? (
                                    <div className="flex items-center gap-4">
                                        <ProfileAvatar
                                            imageUrl={getSafeAvatarUrl(canvasUser.avatar_url)}
                                            label={canvasUser.name}
                                            alt={canvasUser.name || "Profilbilde for Canvas-konto"}
                                            tone="green"
                                        />
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-white">
                                                {canvasUser.name}
                                            </p>
                                            {canvasUser.primary_email && (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {canvasUser.primary_email}
                                                </p>
                                            )}
                                            {opprettetDato && (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    Tilkoblet siden {opprettetDato}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Ikke tilkoblet. Legg til Canvas API-token nedenfor.
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Konto og sikkerhet (Clerk: profil, 2FA, Google/Microsoft/Apple) */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Shield size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Konto og sikkerhet
                            </h3>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            Endre e-post, passord, aktiver to-faktor (2FA) og administrer tilkoblede innloggingsmetoder (Google, Microsoft, Apple). Dette håndteres av innloggingsleverandøren vår (Clerk).
                        </p>
                        <Link
                            href="/profil"
                            prefetch={false}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                        >
                            Rediger profil og sikkerhet
                            <ExternalLink size={14} />
                        </Link>
                    </section>

                    <section className="p-6 md:p-8 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/40">
                                <Trash2 size={20} className="text-red-600 dark:text-red-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Slett konto
                            </h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Dette sletter StudyWise-kontoen din, Canvas-koblinger, preferanser, arbeidsplaner og samtalehistorikk. Handlingen kan ikke angres.
                        </p>

                        {!visKontoSletting ? (
                            <button
                                type="button"
                                onClick={() => setVisKontoSletting(true)}
                                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                            >
                                <Trash2 size={16} />
                                Start kontosletting
                            </button>
                        ) : (
                            <div className="space-y-3 rounded-lg border border-red-200 dark:border-red-900 bg-white/80 dark:bg-slate-900/40 p-4">
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                    Skriv <span className="font-semibold">SLETT</span> for å bekrefte.
                                </p>
                                <input
                                    type="text"
                                    value={kontoSlettBekreftelse}
                                    onChange={(e) => setKontoSlettBekreftelse(e.target.value)}
                                    placeholder="SLETT"
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                                />
                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => void handleSlettKonto()}
                                        disabled={kontoSlettBekreftelse.trim().toUpperCase() !== "SLETT" || isSlettingKonto}
                                        className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSlettingKonto ? "Sletter konto..." : "Slett konto permanent"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setVisKontoSletting(false);
                                            setKontoSlettBekreftelse("");
                                        }}
                                        disabled={isSlettingKonto}
                                        className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                        Avbryt
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Utseende */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                {isDarkMode ? (
                                    <Moon size={20} className="text-slate-600 dark:text-slate-300" />
                                ) : (
                                    <Sun size={20} className="text-slate-600 dark:text-slate-300" />
                                )}
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Utseende
                            </h3>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-700 dark:text-slate-300">Mørk modus</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Bytt mellom lyst og mørkt tema
                                </p>
                            </div>
                            <button
                                onClick={toggleTheme}
                                className={`shrink-0 w-14 h-8 rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 focus:ring-blue-500 ${isDarkMode ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"
                                    }`}
                                role="switch"
                                aria-checked={isDarkMode}
                                aria-label={isDarkMode ? "Deaktiver mørk modus" : "Aktiver mørk modus"}
                            >
                                <span
                                    className={`block w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${isDarkMode ? "translate-x-6" : "translate-x-0"
                                        }`}
                                />
                            </button>
                        </div>
                    </section>

                    {/* Canvas Token */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Key size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Canvas API Token
                            </h3>
                        </div>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            Koble til din Canvas-konto for å hente emner, kunngjøringer,
                            frister og forelesninger. Velg institusjon under før du lagrer tokenet. Listen dekker kjente norske Canvas-instanser, og du kan angi en annen Instructure-URL ved behov.
                        </p>

                        {brukerCanvasBaseUrl && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                                Din institusjon: <span className="font-medium text-slate-800 dark:text-slate-200">{brukerCanvasBaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                            </p>
                        )}

                        {harCanvasToken && (
                            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex gap-2">
                                        <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            Canvas-token er koblet til kontoen din.
                                        </p>
                                    </div>
                                    {/* Slett bekreftelse - Forenklet */}
                                    {!visSlettBekreftelse ? (
                                        <button
                                            onClick={() => setVisSlettBekreftelse(true)}
                                            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                        >
                                            Slett tilkobling
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                                                Er du sikker?
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={handleSlettToken}
                                                    disabled={isSlettingToken}
                                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {isSlettingToken ? "Sletter..." : "Ja, slett Canvas API Token"}
                                                </button>
                                                <button
                                                    onClick={() => setVisSlettBekreftelse(false)}
                                                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded transition-colors"
                                                >
                                                    Avbryt
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <fieldset className="space-y-3">
                            <div>
                                <label htmlFor="canvas-institusjon" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Institusjon (Canvas)
                                </label>
                                <select
                                    id="canvas-institusjon"
                                    value={valgtInstitusjonUrl}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setValgtInstitusjonUrl(v);
                                        setCanvasKonflikt(null);
                                        if (v !== "other") setAnnenCanvasUrl("");
                                    }}
                                    className="w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Velg institusjon</option>
                                    {CANVAS_INSTITUSJONER_NORGE.map((inst) => (
                                        <option key={inst.url} value={inst.url}>{inst.navn}</option>
                                    ))}
                                    <option value="other">Annen Instructure-instans</option>
                                </select>
                                {valgtInstitusjonUrl === "other" ? (
                                    <input
                                        type="url"
                                        value={annenCanvasUrl}
                                        onChange={(e) => {
                                            setAnnenCanvasUrl(e.target.value);
                                            setCanvasKonflikt(null);
                                        }}
                                        placeholder="https://din-skole.instructure.com"
                                        className="mt-2 w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                ) : null}
                                {manglerCanvasUrl && (
                                    <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">
                                        Velg institusjon (eller angi URL) før du lagrer tokenet.
                                    </p>
                                )}
                            </div>
                            {canvasKonflikt && (
                                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                                    <p className="text-sm text-amber-800 dark:text-amber-200">
                                        {canvasKonflikt.melding}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void handleLagreToken(true)}
                                        disabled={isPending || cooldown}
                                        className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isPending ? "Gjenoppretter..." : "Gjenopprett tilkobling"}
                                    </button>
                                </div>
                            )}

                            <div className="relative">
                                <input
                                    type={visToken ? "text" : "password"}
                                    value={canvasToken}
                                    onChange={(e) => {
                                        const nesteToken = e.target.value;
                                        setCanvasToken(nesteToken);
                                        if (canvasKonflikt && nesteToken.trim() !== canvasKonflikt.token) {
                                            setCanvasKonflikt(null);
                                        }
                                    }}
                                    placeholder="Lim inn din Canvas API token"
                                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setVisToken(!visToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                    {visToken ? "Skjul" : "Vis"}
                                </button>
                            </div>

                            <button
                                onClick={() => void handleLagreToken()}
                                disabled={!canvasToken.trim() || isPending || cooldown || manglerCanvasUrl}
                                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isPending ? "Lagrer..." : "Lagre token"}
                            </button>
                        </fieldset>

                        {/* Infoboks */}
                        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                            <div className="flex gap-2">
                                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">Slik får du en API token:</p>
                                    <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
                                        <li>Logg inn på Canvas</li>
                                        <li>Gå til Innstillinger → Godkjente integrasjoner</li>
                                        <li>Klikk &quot;Ny tilgangstoken&quot;</li>
                                        <li>Kopier token og lim inn her</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Samtalehistorikk */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <MessageSquare size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Samtalehistorikk
                            </h3>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            Samtalene lagres kryptert. Du kan slette alt her.
                        </p>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-700 dark:text-slate-300">
                                    Lagrede samtaler
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {chatsLoading ? "Laster..." : `${chats.length} samtaler`}
                                </p>
                            </div>
                            <button
                                onClick={clearChatHistory}
                                aria-label="Slett alle samtaler"
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                <Trash2 size={16} />
                                Slett alle samtaler
                            </button>
                        </div>
                    </section>

                    {/* AI Canvas-kontekst - kun vis hvis bruker har Canvas token */}
                    {harCanvasToken && (
                        <section className="p-5 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                    <Bot size={20} className="text-slate-600 dark:text-slate-300" />
                                </div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">
                                    AI Canvas-kontekst
                                </h3>
                            </div>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                Velg hvilken Canvas-data AI-en skal ha tilgang til når du chatter.
                            </p>
                            <CanvasContextSelector />
                        </section>
                    )}

                </div>
            </div>
        </div>
    );
}

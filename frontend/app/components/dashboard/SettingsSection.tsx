/*
 * SettingsSection - Brukerinnstillinger
 * Håndterer tema, Canvas-token, AI-kontekst og andre preferanser
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Moon, Sun, Key, User, Info, Bot, CheckCircle, Shield, ExternalLink, Languages, Cookie, Bell, FileUp } from "lucide-react";
import { AUTH_ME_QUERY_KEY, CanvasTokenConflictError, useLagreCanvasToken, useSlettCanvasToken } from "@/app/auth/auth-api";
import { resetCanvasTokenStatus, useCanvasUser } from "@/app/canvas/canvas-api";
import { useTheme } from "next-themes";
import { format } from "date-fns";
import { enUS, nb } from "date-fns/locale";
import { showToast } from "@/app/components/ui/Toaster";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { CanvasContextSelector } from "@/app/components/canvas/CanvasContextSelector";
import { CANVAS_INSTITUSJONER_NORGE } from "common/canvasInstitutions";
import { CanvasBaseUrlSchema } from "common/auth";
import { useCookieConsent } from "@/app/hooks/useCookieConsent";
import { useLanguage } from "@/app/i18n";
import { useBrowserPushNotifications } from "@/app/hooks/useBrowserPushNotifications";
import { withCsrfProtection } from "@/app/lib/csrf";
import { fetchApi } from "@/app/lib/apiClient";
import type { BrowserPushPreferences } from "common/notifications";

// Typer for SettingsSection props
interface SettingsSectionProps {
    harCanvasToken?: boolean;
    lokalBrukerEpost?: string;
    /** Nåværende Canvas base URL for brukerens institusjon (fra /me). */
    canvasBaseUrl?: string | null;
    /** Brukerens fornavn (fra /me). */
    fornavn?: string;
    /** Brukerens etternavn (fra /me). */
    etternavn?: string;
    /** Brukerens brukernavn (fra /me). */
    username?: string;
    browserPushPreferences?: BrowserPushPreferences;
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

function normalizeNotionPageIdInput(raw: string): string {
    const value = raw.trim();
    if (!value) return "";

    const directMatch = value.match(
        /^([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
    );
    if (directMatch?.[1]) {
        return directMatch[1].replace(/-/g, "").toLowerCase();
    }

    // Match siste 32-tegns hex-sekvens i URL (Notion page ID er alltid sist i pathen)
    const allMatches = [
        ...value.matchAll(/[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g),
    ];
    if (allMatches.length > 0) {
        return allMatches[allMatches.length - 1][0].replace(/-/g, "").toLowerCase();
    }

    // Behold original input ved ugyldig format; backend gir tydelig valideringsfeil ved lagring.
    return value;
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
    fornavn,
    etternavn,
    username,
    browserPushPreferences,
}: SettingsSectionProps) {
    const { language, setLanguage, t } = useLanguage();
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Sett mounted til true etter første render
    useEffect(() => {
        setMounted(true);
    }, []);

    // Bestem om mørk modus er aktiv
    const isDarkMode = mounted && resolvedTheme === "dark";
    const toggleTheme = () => setTheme(isDarkMode ? "light" : "dark");
    const {
        consent: cookieConsent,
        isPending: isOppdateringCookieConsent,
        setConsent: setCookieConsent,
    } = useCookieConsent();
    const handleCookieChoice = async (choice: "accepted" | "declined") => {
        try {
            await setCookieConsent(choice);
        } catch (error) {
            showToast.error(
                t("settings.cookies.title"),
                lagBrukervennligFeilmelding(
                    error instanceof Error ? error : null,
                    {},
                    t("errors.generic.default"),
                    t,
                ),
            );
        }
    };
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

    const [visSlettBekreftelse, setVisSlettBekreftelse] = useState(false);

    const [cooldown, setCooldown] = useState(false);
    const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Multi-tenant: velg institusjon ved lagring av token
    const [valgtInstitusjonUrl, setValgtInstitusjonUrl] = useState<string>("");
    const datoLocale = language === "en" ? enUS : nb;
    const getCanvasFeilmelding = (error: unknown) =>
        lagBrukervennligFeilmelding(
            error instanceof Error ? error : null,
            { canvas: true },
            t("errors.generic.default"),
            t,
        );

    useEffect(() => {
        return () => {
            if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (!brukerCanvasBaseUrl) {
            setValgtInstitusjonUrl("");
            return;
        }
        const kjentInstitusjon = CANVAS_INSTITUSJONER_NORGE.find(
            (inst) => inst.url === brukerCanvasBaseUrl,
        );
        setValgtInstitusjonUrl(kjentInstitusjon?.url ?? "");
    }, [brukerCanvasBaseUrl]);

    // Hent Canvas-brukerdata for profil-visning
    const canvasUserQuery = useCanvasUser(harCanvasToken);
    const canvasUser = canvasUserQuery.data;
    const browserPush = useBrowserPushNotifications(browserPushPreferences);
    const visningsnavn = [fornavn, etternavn].filter(Boolean).join(" ");
    const brukernavn = username?.trim() || null;

    // --- Notion integration state ---
    const [notionApiKey, setNotionApiKey] = useState("");
    const [notionDefaultPageId, setNotionDefaultPageId] = useState("");
    const [harNotionApiKey, setHarNotionApiKey] = useState(false);
    const [visNotionKey, setVisNotionKey] = useState(false);
    const [isLoadingNotion, setIsLoadingNotion] = useState(true);
    const [isSavingNotion, setIsSavingNotion] = useState(false);
    const [isDeletingNotion, setIsDeletingNotion] = useState(false);
    const [visNotionSlettBekreftelse, setVisNotionSlettBekreftelse] = useState(false);

    // Hent Notion-status ved oppstart
    useEffect(() => {
        const fetchNotionStatus = async () => {
            try {
                const res = await fetchApi("/api/user/notion", { method: "GET" });
                if (res.ok) {
                    const data = await res.json() as {
                        hasApiKey: boolean;
                        defaultPageId: string | null;
                    };
                    setHarNotionApiKey(data.hasApiKey);
                    setNotionDefaultPageId(data.defaultPageId ?? "");
                }
            } catch {
                // Ignore errors, just show as not configured
            } finally {
                setIsLoadingNotion(false);
            }
        };
        void fetchNotionStatus();
    }, []);

    // Lagre Notion-innstillinger
    const handleSaveNotion = async () => {
        if (!notionApiKey.trim() && !notionDefaultPageId.trim()) return;
        setIsSavingNotion(true);
        try {
            const normalizedNotionPageId = normalizeNotionPageIdInput(notionDefaultPageId);
            const res = await fetchApi("/api/user/notion", withCsrfProtection({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey: notionApiKey.trim() || undefined,
                    defaultPageId: normalizedNotionPageId || undefined,
                }),
            }));
            if (!res.ok) {
                const errData = await res.json().catch(() => ({})) as { melding?: string };
                throw new Error(errData.melding || "Kunne ikke lagre");
            }
            const data = await res.json() as { hasApiKey: boolean; defaultPageId: string | null };
            setHarNotionApiKey(data.hasApiKey);
            setNotionDefaultPageId(data.defaultPageId ?? "");
            setNotionApiKey(""); // Clear input after save
            showToast.success(
                t("settings.notionIntegration.saveSuccess.title"),
                t("settings.notionIntegration.saveSuccess.description"),
            );
        } catch (error) {
            showToast.error(
                t("settings.notionIntegration.saveError.title"),
                lagBrukervennligFeilmelding(
                    error instanceof Error ? error : null,
                    {},
                    t("errors.generic.default"),
                    t,
                ),
            );
        } finally {
            setIsSavingNotion(false);
        }
    };

    // Slett Notion-tilkobling
    const handleDeleteNotion = async () => {
        setIsDeletingNotion(true);
        try {
            const res = await fetchApi("/api/user/notion", withCsrfProtection({
                method: "DELETE",
            }));
            if (!res.ok) {
                const errData = await res.json().catch(() => ({})) as { melding?: string };
                throw new Error(errData.melding || "Kunne ikke slette");
            }
            setHarNotionApiKey(false);
            setNotionDefaultPageId("");
            setVisNotionSlettBekreftelse(false);
            showToast.success(
                t("settings.notionIntegration.deleteSuccess.title"),
                t("settings.notionIntegration.deleteSuccess.description"),
            );
        } catch (error) {
            showToast.error(
                t("settings.notionIntegration.deleteError.title"),
                lagBrukervennligFeilmelding(
                    error instanceof Error ? error : null,
                    {},
                    t("errors.generic.default"),
                    t,
                ),
            );
        } finally {
            setIsDeletingNotion(false);
        }
    };

    // Formater opprettelsesdato hvis tilgjengelig
    const opprettetDato = canvasUser?.created_at
        ? format(
            new Date(canvasUser.created_at),
            language === "en" ? "MMMM d, yyyy" : "d. MMMM yyyy",
            { locale: datoLocale },
        )
        : null;

    // Håndter lagring av Canvas token
    const handleLagreToken = async (forceRelink = false) => {
        if (cooldown) return;
        const trimmetToken = (forceRelink ? canvasKonflikt?.token : canvasToken)?.trim();
        if (!trimmetToken) return;
        if (!valgtInstitusjonUrl) {
            showToast.error(
                t("settings.canvasToken.chooseInstitutionTitle"),
                t("settings.canvasToken.chooseInstitutionDescription"),
            );
            return;
        }
        const parsedCanvasBaseUrl = CanvasBaseUrlSchema.safeParse(valgtInstitusjonUrl);
        if (!parsedCanvasBaseUrl.success) {
            showToast.error(
                t("settings.canvasToken.invalidUrlTitle"),
                t("settings.canvasToken.invalidUrlDescription"),
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
            showToast.success(
                t("settings.canvasToken.saveSuccessTitle"),
                t("settings.canvasToken.saveSuccessDescription"),
            );
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
                    t("settings.canvasToken.alreadyConnectedTitle"),
                    t("settings.canvasToken.alreadyConnectedDescription"),
                );
                return;
            }
            showToast.error(t("settings.canvasToken.saveErrorTitle"), getCanvasFeilmelding(err));
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
            showToast.success(
                t("settings.canvasToken.deleteSuccessTitle"),
                t("settings.canvasToken.deleteSuccessDescription"),
            );
        } catch (err) {
            showToast.error(t("settings.canvasToken.deleteErrorTitle"), getCanvasFeilmelding(err));
        }
    };

    const manglerCanvasUrl = !valgtInstitusjonUrl;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {t("settings.title")}
                </h2>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 flex justify-center">
                <div className="max-w-4xl w-full space-y-8">
                    {/* Brukerinformasjon */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                    <User size={20} className="text-slate-600 dark:text-slate-300" />
                                </div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">
                                    {t("settings.profile.title")}
                                </h3>
                            </div>
                            <Link
                                href="/account"
                                prefetch={false}
                                className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                            >
                                {t("settings.accountSecurity.action")}
                                <ExternalLink size={14} />
                            </Link>
                        </div>

                        <div className="space-y-4">
                            {/* Lokal StudyWise-konto */}
                            <div className="flex items-center gap-4">
                                <ProfileAvatar
                                    label={visningsnavn || lokalBrukerEpost}
                                    alt={t("settings.profile.avatarAltStudyWise")}
                                    tone="blue"
                                />
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                        {t("settings.profile.studywiseAccount")}
                                    </p>
                                    {visningsnavn ? (
                                        <p className="font-medium text-slate-900 dark:text-white">
                                            {visningsnavn}
                                        </p>
                                    ) : null}
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {t("settings.profile.primaryEmail")}:{" "}
                                        <span className="font-medium text-slate-700 dark:text-slate-200">
                                            {lokalBrukerEpost || t("common.labels.notSignedIn")}
                                        </span>
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {t("settings.profile.username")}:{" "}
                                        <span className="font-medium text-slate-700 dark:text-slate-200">
                                            {brukernavn ?? t("settings.profile.usernameNotSet")}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            {/* Skillelinje */}
                            <div className="border-t border-slate-100 dark:border-slate-700" />

                            {/* Canvas-tilkobling */}
                            <div>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                                    {t("settings.profile.canvasConnection")}
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
                                            alt={canvasUser.name || t("settings.profile.avatarAltCanvas")}
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
                                                    {t("settings.profile.connectedSince", { date: opprettetDato })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {t("settings.profile.notConnected")}
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Konto og sikkerhet (Clerk + StudyWise-kontosletting) */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Shield size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.accountSecurity.title")}
                            </h3>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {t("settings.accountSecurity.description")}
                        </p>
                        <Link
                            href="/account"
                            prefetch={false}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                        >
                            {t("settings.accountSecurity.action")}
                            <ExternalLink size={14} />
                        </Link>
                    </section>

                    {harCanvasToken && (
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Bell size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.browserPush.title")}
                            </h3>
                        </div>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {t("settings.browserPush.description")}
                        </p>

                        {!browserPush.supported || !browserPush.configured ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {t("settings.browserPush.unsupported")}
                            </p>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                                            {browserPush.preferences.enabled
                                                ? t("settings.browserPush.status.enabled")
                                                : t("settings.browserPush.status.disabled")}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {browserPush.permission === "denied"
                                                ? t("settings.browserPush.permissionDenied")
                                                : t("settings.browserPush.permissionHint")}
                                        </p>
                                    </div>
                                    {browserPush.preferences.enabled ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void browserPush.disable()
                                                    .then(() => {
                                                        showToast.success(
                                                            t("settings.browserPush.disableSuccessTitle"),
                                                            t("settings.browserPush.disableSuccessDescription"),
                                                        );
                                                    })
                                                    .catch((error) => {
                                                        showToast.error(
                                                            t("settings.browserPush.disableErrorTitle"),
                                                            lagBrukervennligFeilmelding(
                                                                error instanceof Error ? error : null,
                                                                {},
                                                                t("errors.generic.default"),
                                                                t,
                                                            ),
                                                        );
                                                    });
                                            }}
                                            disabled={browserPush.isPending}
                                            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                        >
                                            {t("settings.browserPush.disable")}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void browserPush.enable()
                                                    .then(() => {
                                                        showToast.success(
                                                            t("settings.browserPush.enableSuccessTitle"),
                                                            t("settings.browserPush.enableSuccessDescription"),
                                                        );
                                                    })
                                                    .catch((error) => {
                                                        showToast.error(
                                                            t("settings.browserPush.enableErrorTitle"),
                                                            lagBrukervennligFeilmelding(
                                                                error instanceof Error ? error : null,
                                                                {},
                                                                t("errors.generic.default"),
                                                                t,
                                                            ),
                                                        );
                                                    });
                                            }}
                                            disabled={browserPush.isPending}
                                            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                                        >
                                            {t("settings.browserPush.enable")}
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    {([
                                        ["announcements", t("settings.browserPush.channels.announcements")],
                                        ["deadlines", t("settings.browserPush.channels.deadlines")],
                                        ["earlyDeadlines", t("settings.browserPush.channels.earlyDeadlines")],
                                        ["events", t("settings.browserPush.channels.events")],
                                        ["aiResponses", t("settings.browserPush.channels.aiResponses")],
                                    ] as const).map(([key, label]) => (
                                        <label
                                            key={key}
                                            className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={browserPush.preferences[key]}
                                                onChange={(event) => {
                                                    void browserPush.updatePreferences({
                                                        [key]: event.target.checked,
                                                    });
                                                }}
                                                disabled={browserPush.isPending}
                                                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span>{label}</span>
                                        </label>
                                    ))}
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void browserPush.sendTest()
                                                .then((delivered) => {
                                                    if (delivered) {
                                                        showToast.success(
                                                            t("settings.browserPush.testSuccessTitle"),
                                                            t("settings.browserPush.testSuccessDescription"),
                                                        );
                                                    } else {
                                                        showToast.warning(
                                                            t("settings.browserPush.testMissingTitle"),
                                                            t("settings.browserPush.testMissingDescription"),
                                                        );
                                                    }
                                                })
                                                .catch((error) => {
                                                    showToast.error(
                                                        t("settings.browserPush.testErrorTitle"),
                                                        lagBrukervennligFeilmelding(
                                                            error instanceof Error ? error : null,
                                                            {},
                                                            t("errors.generic.default"),
                                                            t,
                                                        ),
                                                    );
                                                });
                                        }}
                                        disabled={
                                            browserPush.isPending ||
                                            !browserPush.preferences.enabled
                                        }
                                        className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                        {t("settings.browserPush.sendTest")}
                                    </button>
                                </div>

                            </div>
                        )}
                    </section>
                    )}

                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Languages size={20} className="text-slate-600 dark:text-slate-300" />

                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.language.title")}
                            </h3>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="language-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                {t("settings.language.label")}
                            </label>
                            <select
                                id="language-select"
                                value={language}
                                onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "nb")}
                                className="w-full max-w-xs min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="nb">{t("settings.language.options.nb")}</option>
                                <option value="en">{t("settings.language.options.en")}</option>
                            </select>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {t("settings.language.help")}
                            </p>
                        </div>
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
                                {t("settings.appearance.title")}
                            </h3>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-700 dark:text-slate-300">{t("settings.appearance.darkMode.label")}</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {t("settings.appearance.darkMode.description")}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={toggleTheme}
                                className={`shrink-0 w-14 h-8 rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 focus:ring-blue-500 ${isDarkMode ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"
                                    }`}
                                role="switch"
                                aria-checked={isDarkMode}
                                aria-label={isDarkMode ? t("settings.appearance.darkMode.disable") : t("settings.appearance.darkMode.enable")}
                            >
                                <span
                                    className={`block w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${isDarkMode ? "translate-x-6" : "translate-x-0"
                                        }`}
                                />
                            </button>
                        </div>
                    </section>

                    {/* Informasjonskapsler */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Cookie size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.cookies.title")}
                            </h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                            {t("settings.cookies.description")}
                        </p>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                {cookieConsent === "accepted"
                                    ? t("settings.cookies.status.accepted")
                                    : cookieConsent === "declined"
                                        ? t("settings.cookies.status.declined")
                                        : t("settings.cookies.status.unknown")}
                            </p>
                            {cookieConsent && (
                                <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                                    cookieConsent === "accepted"
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                }`}>
                                    {cookieConsent === "accepted" ? t("settings.cookies.accepted") : t("settings.cookies.declined")}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleCookieChoice("declined")}
                                disabled={isOppdateringCookieConsent}
                                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    cookieConsent === "declined"
                                        ? "border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white"
                                        : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                                }`}
                            >
                                {t("settings.cookies.declined")}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCookieChoice("accepted")}
                                disabled={isOppdateringCookieConsent}
                                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    cookieConsent === "accepted"
                                        ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                        : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                                }`}
                            >
                                {t("settings.cookies.accepted")}
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
                                {t("settings.canvasToken.title")}
                            </h3>
                        </div>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {t("settings.canvasToken.description")}
                        </p>

                        {brukerCanvasBaseUrl && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                                {t("settings.canvasToken.currentInstitution", {
                                    institution: brukerCanvasBaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
                                })}
                            </p>
                        )}

                        {harCanvasToken && (
                            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex gap-2">
                                        <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            {t("settings.canvasToken.connected")}
                                        </p>
                                    </div>
                                    {/* Slett bekreftelse - Forenklet */}
                                    {!visSlettBekreftelse ? (
                                        <button
                                            type="button"
                                            onClick={() => setVisSlettBekreftelse(true)}
                                            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                        >
                                            {t("settings.canvasToken.deleteConnection")}
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                                                {t("settings.canvasToken.deleteConfirm")}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleSlettToken}
                                                    disabled={isSlettingToken}
                                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {isSlettingToken ? t("settings.canvasToken.deleting") : t("settings.canvasToken.deletingButton")}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setVisSlettBekreftelse(false)}
                                                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded transition-colors"
                                                >
                                                    {t("common.actions.cancel")}
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
                                    {t("settings.canvasToken.institutionLabel")}
                                </label>
                                <select
                                    id="canvas-institusjon"
                                    value={valgtInstitusjonUrl}
                                    aria-required="true"
                                    onChange={(e) => {
                                        setValgtInstitusjonUrl(e.target.value);
                                        setCanvasKonflikt(null);
                                    }}
                                    className="w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">{t("settings.canvasToken.institutionPlaceholder")}</option>
                                    {CANVAS_INSTITUSJONER_NORGE.map((inst) => (
                                        <option key={inst.url} value={inst.url}>{inst.navn}</option>
                                    ))}
                                </select>
                                {manglerCanvasUrl && (
                                    <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">
                                        {t("settings.canvasToken.institutionRequired")}
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
                                        {isPending ? t("settings.canvasToken.restoring") : t("settings.canvasToken.restoreConnection")}
                                    </button>
                                </div>
                            )}

                            <div className="relative">
                                <input
                                    id="canvas-token"
                                    type={visToken ? "text" : "password"}
                                    value={canvasToken}
                                    aria-required="true"
                                    aria-label={t("settings.canvasToken.title")}
                                    onChange={(e) => {
                                        const nesteToken = e.target.value;
                                        setCanvasToken(nesteToken);
                                        if (canvasKonflikt && nesteToken.trim() !== canvasKonflikt.token) {
                                            setCanvasKonflikt(null);
                                        }
                                    }}
                                    placeholder={harCanvasToken ? "••••••••••••••••" : t("settings.canvasToken.placeholder")}
                                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                {canvasToken && (
                                    <button
                                        type="button"
                                        onClick={() => setVisToken(!visToken)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                    >
                                        {visToken ? t("settings.canvasToken.hide") : t("settings.canvasToken.show")}
                                    </button>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => void handleLagreToken()}
                                disabled={!canvasToken.trim() || isPending || cooldown || manglerCanvasUrl}
                                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isPending ? t("settings.canvasToken.saving") : t("settings.canvasToken.save")}
                            </button>
                        </fieldset>

                        {/* Infoboks */}
                        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                            <div className="flex gap-2">
                                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">{t("settings.canvasToken.howTo.title")}</p>
                                    <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
                                        <li>{t("settings.canvasToken.howTo.step1")}</li>
                                        <li>{t("settings.canvasToken.howTo.step2")}</li>
                                        <li>{t("settings.canvasToken.howTo.step3")}</li>
                                        <li>{t("settings.canvasToken.howTo.step4")}</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Notion-integrasjon - kun vis hvis bruker har Canvas-tilkobling */}
                    {harCanvasToken && (<section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <FileUp size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.notionIntegration.title")}
                            </h3>
                        </div>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {t("settings.notionIntegration.description")}
                        </p>

                        {isLoadingNotion ? (
                            <div className="animate-pulse h-10 bg-slate-200 dark:bg-slate-700 rounded-lg" />
                        ) : (
                            <>
                                {harNotionApiKey && (
                                    <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex gap-2">
                                                <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                                                <p className="text-sm text-green-700 dark:text-green-300">
                                                    {t("settings.notionIntegration.connected")}
                                                </p>
                                            </div>
                                            {!visNotionSlettBekreftelse ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setVisNotionSlettBekreftelse(true)}
                                                    className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                                >
                                                    {t("settings.notionIntegration.deleteConnection")}
                                                </button>
                                            ) : (
                                                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                                                        {t("settings.notionIntegration.deleteConfirm")}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleDeleteNotion()}
                                                            disabled={isDeletingNotion}
                                                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {isDeletingNotion ? t("settings.notionIntegration.deleting") : t("settings.notionIntegration.deleteConfirmYes")}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setVisNotionSlettBekreftelse(false)}
                                                            className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded transition-colors"
                                                        >
                                                            {t("common.actions.cancel")}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <fieldset className="space-y-3">
                                    <div className="relative">
                                        <label htmlFor="notion-api-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            {t("settings.notionIntegration.apiKeyLabel")}
                                        </label>
                                        <input
                                            id="notion-api-key"
                                            type={visNotionKey ? "text" : "password"}
                                            value={notionApiKey}
                                            aria-label={t("settings.notionIntegration.apiKeyLabel")}
                                            onChange={(e) => setNotionApiKey(e.target.value)}
                                            placeholder={harNotionApiKey ? "••••••••••••••••" : t("settings.notionIntegration.apiKeyPlaceholder")}
                                            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                        />
                                        {notionApiKey && (
                                            <button
                                                type="button"
                                                onClick={() => setVisNotionKey(!visNotionKey)}
                                                className="absolute right-3 top-8 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                            >
                                                {visNotionKey ? t("settings.notionIntegration.hide") : t("settings.notionIntegration.show")}
                                            </button>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="notion-page-id" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            {t("settings.notionIntegration.defaultPageLabel")}
                                        </label>
                                        <input
                                            id="notion-page-id"
                                            type="text"
                                            value={notionDefaultPageId}
                                            aria-label={t("settings.notionIntegration.defaultPageLabel")}
                                            onChange={(e) => setNotionDefaultPageId(e.target.value)}
                                            onBlur={(e) => setNotionDefaultPageId(normalizeNotionPageIdInput(e.target.value))}
                                            placeholder={t("settings.notionIntegration.defaultPagePlaceholder")}
                                            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                        />
                                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                            {t("settings.notionIntegration.defaultPageHelp")}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => void handleSaveNotion()}
                                        disabled={(!notionApiKey.trim() && !notionDefaultPageId.trim()) || isSavingNotion}
                                        className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isSavingNotion ? t("settings.notionIntegration.saving") : t("settings.notionIntegration.save")}
                                    </button>
                                </fieldset>

                                {/* Infoboks */}
                                <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                                    <div className="flex gap-2">
                                        <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                                        <div className="text-sm text-blue-700 dark:text-blue-300">
                                            <p className="font-medium mb-1">{t("settings.notionIntegration.howTo.title")}</p>
                                            <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
                                                <li>{t("settings.notionIntegration.howTo.step1")}</li>
                                                <li>{t("settings.notionIntegration.howTo.step2")}</li>
                                                <li>{t("settings.notionIntegration.howTo.step3")}</li>
                                                <li>{t("settings.notionIntegration.howTo.step4")}</li>
                                                <li>{t("settings.notionIntegration.howTo.step5")}</li>
                                            </ol>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>)}

                    {/* AI Canvas-kontekst - kun vis hvis bruker har Canvas token */}
                    {harCanvasToken && (
                        <section className="p-5 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                    <Bot size={20} className="text-slate-600 dark:text-slate-300" />
                                </div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">
                                    {t("settings.canvasContext.title")}
                                </h3>
                            </div>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                {t("settings.canvasContext.description")}
                            </p>
                            <CanvasContextSelector />
                        </section>
                    )}

                </div>
            </div>
        </div>
    );
}

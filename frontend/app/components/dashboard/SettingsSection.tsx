/*
 * SettingsSection - Brukerinnstillinger
 * Håndterer tema, Canvas-token, AI-kontekst og andre preferanser
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Moon, Sun, Key, User, Info, Trash2, MessageSquare, Bot, CheckCircle, Shield, ExternalLink, Languages, Cookie, Pencil, Save, X } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { AUTH_ME_QUERY_KEY, CanvasTokenConflictError, useLagreCanvasToken, useSlettCanvasToken, useSlettKonto, useOppdaterProfil } from "@/app/auth/auth-api";
import { resetCanvasTokenStatus, useCanvasUser } from "@/app/canvas/canvas-api";
import { useTheme } from "next-themes";
import { format } from "date-fns";
import { enUS, nb } from "date-fns/locale";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";
import { showToast } from "@/app/components/ui/Toaster";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { CanvasContextSelector } from "@/app/components/canvas/CanvasContextSelector";
import { CANVAS_INSTITUSJONER_NORGE } from "common/canvasInstitutions";
import { CanvasBaseUrlSchema } from "common/auth";
import { useLanguage } from "@/app/i18n";
import {
    COOKIE_CONSENT_STORAGE_KEY,
    COOKIE_CONSENT_CHANGED_EVENT,
    getStoredCookieConsent,
    type CookieConsentStatus,
} from "@/app/components/layout/CookieBanner";

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
    /** Innloggingsmetode (fra /me). */
    authProvider?: string;
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
    fornavn,
    etternavn,
    authProvider,
}: SettingsSectionProps) {
    const clerk = useClerk();
    const { language, setLanguage, t } = useLanguage();
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Profilredigering
    const [redigerProfil, setRedigerProfil] = useState(false);
    const [profilFornavn, setProfilFornavn] = useState(fornavn ?? "");
    const [profilEtternavn, setProfilEtternavn] = useState(etternavn ?? "");
    const { mutateAsync: oppdaterProfil, isPending: isOppdateringProfil } = useOppdaterProfil();

    // Synk lokale felter når props endres (f.eks. etter lagring)
    useEffect(() => {
        if (!redigerProfil) {
            setProfilFornavn(fornavn ?? "");
            setProfilEtternavn(etternavn ?? "");
        }
    }, [fornavn, etternavn, redigerProfil]);

    // Sett mounted til true etter første render
    useEffect(() => {
        setMounted(true);
    }, []);

    // Bestem om mørk modus er aktiv
    const isDarkMode = mounted && resolvedTheme === "dark";
    const toggleTheme = () => setTheme(isDarkMode ? "light" : "dark");
    // Cookie-samtykke
    const [cookieConsent, setCookieConsent] = useState<CookieConsentStatus>(null);
    useEffect(() => {
        setCookieConsent(getStoredCookieConsent());
        const sync = () => setCookieConsent(getStoredCookieConsent());
        window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, sync);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, sync);
            window.removeEventListener("storage", sync);
        };
    }, []);
    const handleCookieChoice = (choice: "accepted" | "declined") => {
        try {
            localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
            window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: choice }));
        } catch { /* ignore */ }
        setCookieConsent(choice);
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
    const datoLocale = language === "en" ? enUS : nb;
    const slettBekreftelsesord = t("settings.deleteAccount.confirmKeyword");
    const getCanvasFeilmelding = (error: unknown) =>
        lagBrukervennligFeilmelding(
            error instanceof Error ? error : null,
            { canvas: true },
            t("errors.generic.default"),
            t,
        );
    const getGenerellFeilmelding = (error: unknown) =>
        lagBrukervennligFeilmelding(
            error instanceof Error ? error : null,
            {},
            t("errors.generic.default"),
            t,
        );

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
        const valgtCanvasBaseUrl = valgtInstitusjonUrl === "other"
            ? annenCanvasUrl.trim()
            : valgtInstitusjonUrl;
        if (!valgtCanvasBaseUrl) {
            showToast.error(
                t("settings.canvasToken.chooseInstitutionTitle"),
                t("settings.canvasToken.chooseInstitutionDescription"),
            );
            return;
        }
        const parsedCanvasBaseUrl = CanvasBaseUrlSchema.safeParse(valgtCanvasBaseUrl);
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

    const handleSlettKonto = async () => {
        const fullforLokalUtlogging = () => {
            broadcastLogout();
            clearClientAuthState(queryClient);
            window.location.assign("/");
        };

        try {
            const result = await slettKonto();

            if (result.providerAccountDeleted) {
                showToast.success(
                    t("settings.deleteAccount.deleteSuccessTitle"),
                    t("settings.deleteAccount.deleteSuccessDescription"),
                );
            } else {
                showToast.warning(
                    t("settings.deleteAccount.deletePartialTitle"),
                    t("settings.deleteAccount.deletePartialDescription"),
                );
            }

            // Alltid signOut fra Clerk slik at lokal sesjon fjernes og vi unngår 401-flyt på neste side lasting
            try {
                await clerk.signOut();
            } catch {
                showToast.error(
                    t("settings.deleteAccount.manualSignOutTitle"),
                    t("settings.deleteAccount.manualSignOutDescription"),
                );
                return;
            }

            fullforLokalUtlogging();
        } catch (err) {
            showToast.error(t("settings.deleteAccount.deleteErrorTitle"), getGenerellFeilmelding(err));
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
                            {!redigerProfil && (
                                <button
                                    type="button"
                                    onClick={() => setRedigerProfil(true)}
                                    className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                >
                                    <Pencil size={14} />
                                    {t("settings.profile.edit")}
                                </button>
                            )}
                        </div>

                        <div className="space-y-4">
                            {/* Lokal StudyWise-konto */}
                            <div className="flex items-center gap-4">
                                <ProfileAvatar
                                    label={fornavn && etternavn ? `${fornavn} ${etternavn}` : lokalBrukerEpost}
                                    alt={t("settings.profile.avatarAltStudyWise")}
                                    tone="blue"
                                />
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                        {t("settings.profile.studywiseAccount")}
                                    </p>
                                    {fornavn || etternavn ? (
                                        <p className="font-medium text-slate-900 dark:text-white">
                                            {[fornavn, etternavn].filter(Boolean).join(" ")}
                                        </p>
                                    ) : null}
                                    <p className={`${fornavn || etternavn ? "text-sm text-slate-500 dark:text-slate-400" : "font-medium text-slate-900 dark:text-white"}`}>
                                        {lokalBrukerEpost || t("common.labels.notSignedIn")}
                                    </p>
                                    {authProvider && (
                                        <p className="text-xs text-slate-400 dark:text-slate-500 capitalize">
                                            {t("settings.profile.signedInWith", { provider: authProvider === "email" ? t("settings.profile.providers.email") : authProvider === "google" ? "Google" : "Microsoft" })}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Profilredigering */}
                            {redigerProfil && (
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="profil-fornavn" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                                {t("settings.profile.firstName")}
                                            </label>
                                            <input
                                                id="profil-fornavn"
                                                type="text"
                                                value={profilFornavn}
                                                onChange={(e) => setProfilFornavn(e.target.value)}
                                                placeholder={t("settings.profile.firstNamePlaceholder")}
                                                className="w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="profil-etternavn" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                                {t("settings.profile.lastName")}
                                            </label>
                                            <input
                                                id="profil-etternavn"
                                                type="text"
                                                value={profilEtternavn}
                                                onChange={(e) => setProfilEtternavn(e.target.value)}
                                                placeholder={t("settings.profile.lastNamePlaceholder")}
                                                className="w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            disabled={isOppdateringProfil}
                                            onClick={async () => {
                                                try {
                                                    await oppdaterProfil({
                                                        firstName: profilFornavn,
                                                        lastName: profilEtternavn,
                                                    });
                                                    setRedigerProfil(false);
                                                    showToast.success(
                                                        t("settings.profile.saveSuccessTitle"),
                                                        t("settings.profile.saveSuccessDescription"),
                                                    );
                                                } catch {
                                                    showToast.error(
                                                        t("settings.profile.saveErrorTitle"),
                                                        t("settings.profile.saveErrorDescription"),
                                                    );
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <Save size={14} />
                                            {isOppdateringProfil ? t("settings.profile.saving") : t("settings.profile.save")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRedigerProfil(false);
                                                setProfilFornavn(fornavn ?? "");
                                                setProfilEtternavn(etternavn ?? "");
                                            }}
                                            disabled={isOppdateringProfil}
                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                        >
                                            <X size={14} />
                                            {t("common.actions.cancel")}
                                        </button>
                                    </div>
                                </div>
                            )}

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

                    {/* Konto og sikkerhet (Clerk: profil, 2FA, Google/Microsoft/Apple) */}
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
                            href="/profil"
                            prefetch={false}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                        >
                            {t("settings.accountSecurity.action")}
                            <ExternalLink size={14} />
                        </Link>
                    </section>

                    <section className="p-6 md:p-8 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/40">
                                <Trash2 size={20} className="text-red-600 dark:text-red-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.deleteAccount.title")}
                            </h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            {t("settings.deleteAccount.description")}
                        </p>

                        {!visKontoSletting ? (
                            <button
                                type="button"
                                onClick={() => setVisKontoSletting(true)}
                                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                            >
                                <Trash2 size={16} />
                                {t("settings.deleteAccount.start")}
                            </button>
                        ) : (
                            <div className="space-y-3 rounded-lg border border-red-200 dark:border-red-900 bg-white/80 dark:bg-slate-900/40 p-4">
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                    {t("settings.deleteAccount.confirmInstruction", { keyword: slettBekreftelsesord })}
                                </p>
                                <input
                                    type="text"
                                    value={kontoSlettBekreftelse}
                                    onChange={(e) => setKontoSlettBekreftelse(e.target.value)}
                                    placeholder={t("settings.deleteAccount.confirmPlaceholder")}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                                />
                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => void handleSlettKonto()}
                                        disabled={kontoSlettBekreftelse.trim().toUpperCase() !== slettBekreftelsesord.toUpperCase() || isSlettingKonto}
                                        className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSlettingKonto ? t("settings.deleteAccount.deleting") : t("settings.deleteAccount.deletePermanent")}
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
                                        {t("settings.deleteAccount.cancel")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

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
                                        const v = e.target.value;
                                        setValgtInstitusjonUrl(v);
                                        setCanvasKonflikt(null);
                                        if (v !== "other") setAnnenCanvasUrl("");
                                    }}
                                    className="w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">{t("settings.canvasToken.institutionPlaceholder")}</option>
                                    {CANVAS_INSTITUSJONER_NORGE.map((inst) => (
                                        <option key={inst.url} value={inst.url}>{inst.navn}</option>
                                    ))}
                                    <option value="other">{t("settings.canvasToken.institutionOther")}</option>
                                </select>
                                {valgtInstitusjonUrl === "other" ? (
                                    <input
                                        type="url"
                                        value={annenCanvasUrl}
                                        aria-required="true"
                                        onChange={(e) => {
                                            setAnnenCanvasUrl(e.target.value);
                                            setCanvasKonflikt(null);
                                        }}
                                        placeholder={t("settings.canvasToken.customUrlPlaceholder")}
                                        className="mt-2 w-full min-h-11 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                ) : null}
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
                                    placeholder={t("settings.canvasToken.placeholder")}
                                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setVisToken(!visToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                    {visToken ? t("settings.canvasToken.hide") : t("settings.canvasToken.show")}
                                </button>
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

                    {/* Samtalehistorikk */}
                    <section className="p-6 md:p-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <MessageSquare size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                {t("settings.chatHistory.title")}
                            </h3>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {t("settings.chatHistory.description")}
                        </p>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-700 dark:text-slate-300">
                                    {t("settings.chatHistory.savedChats")}
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {chatsLoading
                                        ? t("settings.chatHistory.loading")
                                        : t(
                                            chats.length === 1
                                                ? "settings.chatHistory.countOne"
                                                : "settings.chatHistory.countOther",
                                            { count: chats.length },
                                        )}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={clearChatHistory}
                                aria-label={t("settings.chatHistory.clearAll")}
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                <Trash2 size={16} />
                                {t("settings.chatHistory.clearAll")}
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

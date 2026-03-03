/*
 * CanvasSection - Canvas visning
 * Viser kunngjøringer, emner og moduler fra Canvas LMS
 * Håndterer datahenting, visning og navigasjon innen Canvas-seksjonen
 */
"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import {
    ArrowLeft,
    ChevronRight,
    ExternalLink,
    FileText,
    Loader2,
    AlertCircle,
    Download,
    BookOpen,
    Sparkles,
    ChevronDown,
    ChevronUp,
    CheckCircle2,
} from "lucide-react";
import {
    useCanvasAnnouncements,
    useCanvasCourses,
    useCanvasModules,
    useCanvasFiles,
    useCanvasPages,
    useCanvasFrontPage,
    useCoursesMetadata,
    openModuleItem,
    type CourseContentMetadata,
} from "../canvas/canvas-api";
import { useUIStore } from "../store/uiStore";
import { useKIOppsummering, type KIOppsummeringResponse } from "../ki/ki-api";
import { showToast } from "./Toaster";
import { createCanvasHtmlParser, parseCanvasHtml, sikkerFilNedlastingUrl } from "../canvas/canvasHtml";
import { CanvasPageVisning } from "./CanvasPageVisning";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";

// Typer for Canvas visninger
type CanvasVisning = "announcements" | "courses";

// Props for CanvasSection komponent
interface CanvasSectionProps {
    startVisning?: CanvasVisning;
    harCanvasToken?: boolean;
}

// Validering mot DOM-basert XSS - tillater kun http/https for href
// Hjelpefunksjon for å parse style-streng til CSSProperties
const normalizeStyle = (style?: string | CSSProperties) => {
    if (!style) return undefined;
    if (typeof style !== "string") return style;

    return style.split(";").reduce((acc, decl) => {
        const [rawProp, rawValue] = decl.split(":");
        if (!rawProp || !rawValue) return acc;

        const prop = rawProp.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const value = rawValue.trim();
        if (!prop || !value) return acc;

        (acc as Record<string, string>)[prop] = value;
        return acc;
    }, {} as CSSProperties);
};

// Tilpasset Bilde-komponent med laste-tilstand og håndtering av lasting/feil
const TilpassetBilde = ({
    src,
    alt,
    style,
    className: _className, // Ignorerer className/class fra props - vi setter vår egen
    class: _class, // HTML class attributt fra DOM parser
    ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { class?: string }) => {
    const [laster, settLaster] = useState(true);
    const safeStyle = normalizeStyle(style);

    // Render bilde med laste-effekt
    return (
        <span className="relative my-3 inline-block overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            {laster && (
                <span className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-700" />
            )}
            <img
                src={src}
                alt={alt}
                {...props}
                className={`transition-opacity duration-500 ${laster ? "opacity-0" : "opacity-100"} max-w-full max-h-75 w-auto h-auto object-contain`}
                style={safeStyle}
                onLoad={() => settLaster(false)}
                loading="lazy"
            />
        </span>
    );
};

// HTML parser for Canvas innhold
const htmlParser = createCanvasHtmlParser((domNode) => (
    <TilpassetBilde
        src={domNode.attribs.src}
        alt={domNode.attribs.alt || "Canvas bilde"}
        {...domNode.attribs}
    />
));

// Laste-skjelett
function LasteSkjelett({ linjer = 3 }: { linjer?: number }) {
    return (
        <div className="space-y-3 animate-pulse">
            {Array.from({ length: linjer }).map((_, i) => (
                <div
                    key={i}
                    className="h-4 bg-slate-200 dark:bg-slate-700 rounded"
                    style={{ width: `${85 - i * 15}%` }}
                />
            ))}
        </div>
    );
}

// Feilmelding-komponent
function FeilMelding({ melding }: { melding: string }) {
    return (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{melding}</p>
        </div>
    );
}

// KI-oppsummering for én kunngjøring
function KunngjoringOppsummering({ tekst }: { tekst: string }) {
    const { oppsummer, isPending, data, error } = useKIOppsummering();
    const [aapen, settAapen] = useState(false);
    const [resultat, settResultat] = useState<KIOppsummeringResponse | null>(null);

    const handleOppsummer = useCallback(() => {
        if (resultat) {
            settAapen((v) => !v);
            return;
        }
        oppsummer(tekst, {
            type: "begge",
            onSuccess: (data) => {
                settResultat(data);
                settAapen(true);
            },
            onError: (err) => {
                showToast.error("Kunne ikke oppsummere", err.message);
            },
        });
    }, [tekst, oppsummer, resultat]);

    // Oppdater resultat fra data
    useEffect(() => {
        if (data?.suksess && !resultat) {
            settResultat(data);
            settAapen(true);
        }
    }, [data, resultat]);

    return (
        <div className="mt-3">
            <button
                onClick={handleOppsummer}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50"
            >
                {isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                ) : (
                    <Sparkles size={14} />
                )}
                {resultat ? (aapen ? "Skjul oppsummering" : "Vis oppsummering") : "Oppsummer med KI"}
                {resultat && (aapen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>

            {aapen && resultat && (
                <div className="mt-3 p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 space-y-3">
                    {resultat.oppsummering && (
                        <div>
                            <h4 className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-1">
                                TL;DR
                            </h4>
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                {resultat.oppsummering}
                            </p>
                        </div>
                    )}
                    {resultat.handlinger && resultat.handlinger.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-1">
                                Handlingspunkter
                            </h4>
                            <ul className="space-y-1">
                                {resultat.handlinger.map((handling, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 size={14} className="text-purple-500 mt-0.5 shrink-0" />
                                        {handling}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {!resultat.oppsummering && (!resultat.handlinger || resultat.handlinger.length === 0) && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Ingen oppsummering tilgjengelig.
                        </p>
                    )}
                </div>
            )}

            {error && !resultat && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error.message}</p>
            )}
        </div>
    );
}

// Kunngjørings-visning
function KunngjoringVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasAnnouncements(harCanvasToken);

    if (!harCanvasToken) {
        return <FeilMelding melding="Du må lagre en Canvas API-token før du kan hente kunngjøringer." />;
    }

    if (isLoading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <LasteSkjelett />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return <FeilMelding melding={lagBrukervennligFeilmelding(error instanceof Error ? error : null, { canvas: true }, "Kunne ikke laste kunngjøringer. Prøv igjen.")} />;
    }

    if (!data?.announcements?.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">Ingen kunngjøringer</p>
            </div>
        );
    }

    // Vis kunngjøringer
    return (
        <div className="space-y-4">
            {data.announcements.map((announcement) => (
                <article
                    key={announcement.id}
                    className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 transition-colors hover:border-slate-300 dark:hover:border-slate-600"
                >
                    <header className="mb-3">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                            {announcement.title}
                        </h3>
                        {announcement.posted_at && (
                            <time className="text-sm text-slate-500 dark:text-slate-400">
                                {formatDistanceToNow(new Date(announcement.posted_at), {
                                    addSuffix: true,
                                    locale: nb,
                                })}
                            </time>
                        )}
                    </header>

                    {announcement.message && (
                        <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-300">
                            {parseCanvasHtml(announcement.message, htmlParser)}
                        </div>
                    )}

                    {announcement.message && (
                        <KunngjoringOppsummering tekst={announcement.message} />
                    )}
                </article>
            ))}
        </div>
    );
}

// Emne-visning
function EmneVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasCourses(harCanvasToken);
    const metadataQuery = useCoursesMetadata(harCanvasToken);
    const [valgtEmneId, settValgtEmneId] = useState<number | null>(null);
    const [valgtEmneVisning, settValgtEmneVisning] = useState<"modules" | "files" | "frontpage">("frontpage");
    const [valgtSide, settValgtSide] = useState<{ pageId: string; courseId: number } | null>(null);

    // Hent metadata for et emne (med fallback til "ukjent" hvis ikke lastet)
    const getMetadata = (courseId: number): CourseContentMetadata | null => {
        if (!metadataQuery.data?.metadata) return null;
        return metadataQuery.data.metadata[String(courseId)] || null;
    };

    // Beregn om queries skal være aktivert basert på metadata
    // Dette forhindrer unødvendige API-kall for innhold som ikke finnes eller brukeren ikke har tilgang til
    const valgtMeta = valgtEmneId ? getMetadata(valgtEmneId) : null;
    const metaReady = !metadataQuery.isLoading && !!metadataQuery.data?.metadata;

    // Kun fetch hvis metadata sier innhold finnes, eller metadata ikke er klar ennå (for backward compat)
    const modulerQuery = useCanvasModules(valgtEmneId, harCanvasToken && (!metaReady || valgtMeta?.hasModules === true));
    const filerQuery = useCanvasFiles(valgtEmneId, harCanvasToken && (!metaReady || valgtMeta?.hasFiles === true));
    const siderQuery = useCanvasPages(valgtEmneId, harCanvasToken && (!metaReady || valgtMeta?.hasModules === true)); // Pages brukes for moduler
    const frontPageQuery = useCanvasFrontPage(valgtEmneId, harCanvasToken && (!metaReady || valgtMeta?.hasFrontPage === true));

    if (!harCanvasToken) {
        return <FeilMelding melding="Du må lagre en Canvas API-token før du kan hente emner." />;
    }

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <LasteSkjelett linjer={2} />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return <FeilMelding melding={lagBrukervennligFeilmelding(error instanceof Error ? error : null, { canvas: true }, "Kunne ikke laste emner. Prøv igjen.")} />;
    }

    // Vis valgt side hvis satt
    if (valgtSide) {
        return (
            <CanvasPageVisning
                courseId={valgtSide.courseId}
                pageId={valgtSide.pageId}
                onBack={() => settValgtSide(null)}
            />
        );
    }

    // Vis moduler for valgt emne
    if (valgtEmneId) {
        const course = data?.courses.find((e) => e.id === valgtEmneId);

        return (
            <div>
                <button
                    onClick={() => settValgtEmneId(null)}
                    className="flex items-center gap-2 mb-6 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <ArrowLeft size={16} />
                    Tilbake til emner
                </button>

                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                    {course?.name}
                </h3>

                {/* Vis tabs kun for innhold som finnes */}
                {(() => {
                    const meta = getMetadata(valgtEmneId);
                    const metadataLaster = metadataQuery.isLoading;
                    const visForsideTab = metadataLaster || !meta || meta.hasFrontPage;
                    const visModulerTab = metadataLaster || !meta || meta.hasModules;
                    const visFilerTab = metadataLaster || !meta || meta.hasFiles;

                    return (
                        <div className="mb-4 flex flex-wrap gap-2">
                            {visForsideTab && (
                                <button
                                    onClick={() => settValgtEmneVisning("frontpage")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "frontpage" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    Forside
                                </button>
                            )}
                            {visModulerTab && (
                                <button
                                    onClick={() => settValgtEmneVisning("modules")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "modules" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    Moduler{meta?.modulesCount ? ` (${meta.modulesCount})` : ""}
                                </button>
                            )}
                            {visFilerTab && (
                                <button
                                    onClick={() => settValgtEmneVisning("files")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "files" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    Filer{meta?.filesCount ? ` (${meta.filesCount})` : ""}
                                </button>
                            )}
                        </div>
                    );
                })()}

                {valgtEmneVisning === "frontpage" && (
                    <div className="space-y-3">
                        {frontPageQuery.isLoading && (
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Loader2 size={16} className="animate-spin" />
                                Laster forside...
                            </div>
                        )}
                        {frontPageQuery.isError && (
                            <FeilMelding melding={frontPageQuery.error instanceof Error ? frontPageQuery.error.message : "Kunne ikke laste forside"} />
                        )}
                        {frontPageQuery.data && (
                            <article className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                                <header className="mb-3 flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                                    <BookOpen size={18} /> {frontPageQuery.data.title || "Forside"}
                                </header>
                                {frontPageQuery.data.body ? (
                                    <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-200">
                                        {parseCanvasHtml(frontPageQuery.data.body, htmlParser)}
                                    </div>
                                ) : (
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">Ingen innhold på forsiden.</p>
                                )}
                            </article>
                        )}
                        {!frontPageQuery.isLoading && !frontPageQuery.data && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Forside ikke tilgjengelig.</p>
                        )}
                    </div>
                )}

                {valgtEmneVisning === "modules" && (
                    <>
                        {modulerQuery.isLoading && (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <Loader2 size={16} className="animate-spin" />
                        Laster moduler...
                    </div>
                )}

                        {modulerQuery.isError && (
                            <FeilMelding melding="Ingen tilgang til moduler for dette emnet (403/unauthorized)." />
                        )}

                        {/* Vis melding når query er disabled pga metadata sier ingen moduler */}
                        {!modulerQuery.isLoading && !modulerQuery.isError && !modulerQuery.data?.modules?.length && metaReady && valgtMeta?.hasModules === false && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Dette emnet har ingen moduler tilgjengelig.</p>
                        )}

                {modulerQuery.data?.modules && modulerQuery.data.modules.length > 0 && (
                    <div className="space-y-4">
                        {modulerQuery.data.modules.map((module) => (
                            <div
                                key={module.id}
                                className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
                            >
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <h4 className="font-medium text-slate-900 dark:text-white">
                                        {module.name}
                                    </h4>
                                </div>

                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {module.items?.map((item) => {
                                        // Bestem ikon og handling basert på type
                                        const isPage = item.type === "Page";
                                        const isFile = item.type === "File";
                                        const isExternal = item.type === "ExternalUrl";

                                        // Sikker nedlastingssti for filer (validerer content_id)
                                        // Returnerer kun relative URLs på egen server
                                        const downloadPath = isFile 
                                            ? sikkerFilNedlastingUrl(item.content_id)
                                            : undefined;

                                        // Endelig sikker href - inline validering for Snyk dataflyt-analyse
                                        // Verifiserer protokoll eksplisitt for å forhindre XSS via javascript:, data: etc.
                                        const safeHref: string = ((): string => {
                                            // Prioritet 1: Relativ API-sti for filer (alltid trygg)
                                            if (downloadPath && downloadPath.startsWith("/api/")) {
                                                return downloadPath;
                                            }
                                            
                                            // Prioritet 2: For filer uten content_id, bruk # og håndter dynamisk
                                            if (isFile && !downloadPath) {
                                                return "#";
                                            }
                                            
                                            // Prioritet 3: Eksterne URL-er - krever eksplisitt protokoll-validering
                                            const rawUrl = isExternal ? item.external_url : item.html_url;
                                            if (typeof rawUrl === "string" && rawUrl.length > 0) {
                                                const trimmed = rawUrl.trim();
                                                // Kun tillat http:// og https:// protokoller
                                                if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
                                                    return trimmed;
                                                }
                                            }
                                            
                                            // Fallback: Sikker default
                                            return "#";
                                        })();

                                        // Håndter klikk på item
                                        const handleClick = async (e: React.MouseEvent) => {
                                            if (isPage && item.page_url) {
                                                e.preventDefault();
                                                settValgtSide({ pageId: item.page_url, courseId: valgtEmneId });
                                                return;
                                            }
                                            // For filer med content_id: åpne direkte
                                            if (isFile && downloadPath && downloadPath.startsWith("/api/")) {
                                                e.preventDefault();
                                                window.open(downloadPath, "_blank", "noopener,noreferrer");
                                                return;
                                            }
                                            // For filer UTEN content_id: hent dynamisk via /open endpoint
                                            if (isFile && !downloadPath && valgtEmneId) {
                                                e.preventDefault();
                                                try {
                                                    const result = await openModuleItem(valgtEmneId, module.id, item.id);
                                                    if (result.type === "File" && result.downloadPath) {
                                                        // Ekstraher og valider fil-ID fra downloadPath for å forhindre Open Redirect
                                                        // Forventet format: /api/canvas/filer/{fileId}/download
                                                        const pathMatch = /^\/api\/canvas\/filer\/(\d+)\/download$/.exec(result.downloadPath);
                                                        if (pathMatch && pathMatch[1]) {
                                                            // Rekonstruer URL fra validert ID - bryter taint-kjeden
                                                            const validatedFileId = pathMatch[1];
                                                            const safeUrl = `/api/canvas/filer/${encodeURIComponent(validatedFileId)}/download`;
                                                            window.open(safeUrl, "_blank", "noopener,noreferrer");
                                                        }
                                                    }
                                                } catch (err) {
                                                    console.error("Kunne ikke åpne fil:", err);
                                                }
                                            }
                                        };

                                        // Render item
                                        return (
                                            <a
                                                key={item.id}
                                                href={safeHref}
                                                target={isPage ? undefined : "_blank"}
                                                rel="noopener noreferrer"
                                                onClick={handleClick}
                                                className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                                            >
                                                {isPage ? (
                                                    <BookOpen
                                                        size={16}
                                                        className="text-slate-400 dark:text-slate-500 shrink-0"
                                                    />
                                                ) : isFile ? (
                                                    <Download
                                                        size={16}
                                                        className="text-slate-400 dark:text-slate-500 shrink-0"
                                                    />
                                                ) : (
                                                    <FileText
                                                        size={16}
                                                        className="text-slate-400 dark:text-slate-500 shrink-0"
                                                    />
                                                )}

                                                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white truncate">
                                                    {item.title}
                                                </span>

                                                {isPage ? (
                                                    <ChevronRight
                                                        size={14}
                                                        className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 shrink-0"
                                                    />
                                                ) : (
                                                    <ExternalLink
                                                        size={14}
                                                        className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 shrink-0"
                                                    />
                                                )}
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Fallback: vis frontpage -> sider -> filer når moduler er tomme */}
                {modulerQuery.data && modulerQuery.data.modules.length === 0 && (
                    <div className="space-y-4">
                        {frontPageQuery.isLoading && (
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Loader2 size={16} className="animate-spin" />
                                Laster forside...
                            </div>
                        )}

                        {frontPageQuery.data && (
                            <article className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                                <header className="mb-3 flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                                    <BookOpen size={18} /> Forside
                                </header>
                                {frontPageQuery.data.body ? (
                                    <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-200">
                                        {parseCanvasHtml(frontPageQuery.data.body, htmlParser)}
                                    </div>
                                ) : (
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">Ingen innhold på forsiden.</p>
                                )}
                            </article>
                        )}

                        {siderQuery.data && siderQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    Sider
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {siderQuery.data.map((p) => (
                                        <button
                                            key={p.url}
                                            onClick={() => settValgtSide({ pageId: p.url, courseId: valgtEmneId! })}
                                            className="w-full text-left px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2"
                                        >
                                            <FileText size={16} className="text-slate-400" />
                                            <span>{p.title || p.url}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(!siderQuery.data || siderQuery.data.length === 0) && filerQuery.data && filerQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    Filer
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filerQuery.data.map((f) => {
                                        const filUrl = sikkerFilNedlastingUrl(f.id);
                                        if (!filUrl) return null;
                                        return (
                                        <a
                                            key={f.id}
                                            href={filUrl}
                                            className="flex px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 items-center gap-2"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <Download size={16} className="text-slate-400" />
                                            <span>{f.display_name || f.filename}</span>
                                        </a>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                    </>
                )}

                {valgtEmneVisning === "files" && (
                    <div className="space-y-3">
                        {filerQuery.isLoading && (
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Loader2 size={16} className="animate-spin" />
                                Laster filer...
                            </div>
                        )}
                        {filerQuery.isError && (
                            <FeilMelding melding="Dette emnet har ingen filer eller du mangler tilgang (403/unauthorized)." />
                        )}
                        {/* Vis melding når query er disabled pga metadata sier ingen filer */}
                        {!filerQuery.isLoading && !filerQuery.isError && !filerQuery.data && metaReady && valgtMeta?.hasFiles === false && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Dette emnet har ingen filer tilgjengelig.</p>
                        )}
                        {filerQuery.data && filerQuery.data.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Dette emnet har ingen filer å vise.</p>
                        )}
                        {filerQuery.data && filerQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    Filer
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filerQuery.data.map((f) => {
                                        const filUrl = sikkerFilNedlastingUrl(f.id);
                                        if (!filUrl) return null;
                                        return (
                                        <a
                                            key={f.id}
                                            href={filUrl}
                                            className="flex px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 items-center gap-2"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <Download size={16} className="text-slate-400" />
                                            <span>{f.display_name || f.filename}</span>
                                        </a>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // Vis emner liste
    if (!data?.courses?.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">Ingen emner funnet</p>
            </div>
        );
    }

    // Render emner
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.courses.map((emne) => {
                    const meta = getMetadata(emne.id);
                    const metadataLaster = metadataQuery.isLoading;

                    // Bestem hvilken visning som skal være default basert på metadata
                    const velgDefaultVisning = (): "frontpage" | "modules" | "files" => {
                        if (!meta) return "frontpage"; // Fallback mens metadata laster
                        if (meta.hasFrontPage) return "frontpage";
                        if (meta.hasModules) return "modules";
                        if (meta.hasFiles) return "files";
                        return "frontpage";
                    };

                    // Vis knapper kun for innhold som finnes
                    const visForsideKnapp = !meta || meta.hasFrontPage;
                    const visModulerKnapp = !meta || meta.hasModules;
                    const visFilerKnapp = !meta || meta.hasFiles;
                    const harInnhold = visForsideKnapp || visModulerKnapp || visFilerKnapp;

                    return (
                        <div
                            key={emne.id}
                            className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group cursor-pointer"
                            onClick={() => { settValgtEmneId(emne.id); settValgtEmneVisning(velgDefaultVisning()); }}
                        >
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                {emne.name}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                                {emne.course_code}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {metadataLaster ? (
                                    <>
                                        <div className="h-6 w-16 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="h-6 w-20 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="h-6 w-14 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                    </>
                                ) : (
                                    <>
                                        {visForsideKnapp && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("frontpage"); }}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                Forside
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visModulerKnapp && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("modules"); }}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                Moduler{meta?.modulesCount ? ` (${meta.modulesCount})` : ""}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visFilerKnapp && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("files"); }}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                Filer{meta?.filesCount ? ` (${meta.filesCount})` : ""}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {!harInnhold && (
                                            <span className="text-sm text-slate-400 dark:text-slate-500 italic">
                                                Ingen innhold
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

// Advarsel når Canvas-token er ugyldig/slettet
function TokenUgyldigAdvarsel() {
    return (
        <div className="mx-4 md:mx-6 mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
            <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                    <h3 className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                        Canvas-tilkobling feilet
                    </h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        Canvas API-tokenet ditt er ugyldig, utløpt eller slettet i Canvas.
                        Gå til <strong>Innstillinger</strong> for å legge til et nytt token.
                    </p>
                </div>
            </div>
        </div>
    );
}

// Hovedkomponent
export function CanvasSection({ startVisning = "announcements", harCanvasToken = false }: CanvasSectionProps) {
    const [visning, settVisning] = useState<CanvasVisning>(startVisning);
    const canvasTokenInvalid = useUIStore((state) => state.canvasTokenInvalid);

    // Oppdater visning hvis startVisning endres
    useEffect(() => {
        settVisning(startVisning);
    }, [startVisning]);

    const visningTitler: Record<CanvasVisning, string> = {
        announcements: "Kunngjøringer",
        courses: "Mine emner",
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {visningTitler[visning]}
                </h2>
            </div>

            {/* Advarsel ved ugyldig token */}
            {canvasTokenInvalid && <TokenUgyldigAdvarsel />}

            {/* Innhold */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {visning === "announcements" && <KunngjoringVisning harCanvasToken={harCanvasToken} />}
                {visning === "courses" && <EmneVisning harCanvasToken={harCanvasToken} />}
            </div>
        </div>
    );
}  
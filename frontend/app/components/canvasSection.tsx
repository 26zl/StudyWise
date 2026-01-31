/*
 * CanvasSection - Canvas visning
 * Viser kunngjøringer, emner og moduler fra Canvas LMS
 * Håndterer datahenting, visning og navigasjon innen Canvas-seksjonen
 */
"use client";

import { useState, useEffect, type CSSProperties } from "react";
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
} from "lucide-react";
import {
    useCanvasAnnouncements,
    useCanvasCourses,
    useCanvasModules,
    useCanvasUser,
    useCanvasFiles,
    useCanvasPages,
    useCanvasFrontPage,
} from "../canvas/canvas-api";
import { createCanvasHtmlParser, parseCanvasHtml, sikkerHref } from "../canvas/canvasHtml";
import { CanvasPageVisning } from "./CanvasPageVisning";

// Typer for Canvas visninger
type CanvasVisning = "announcements" | "courses" | "data";

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
    ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) => {
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
        return <FeilMelding melding={error?.message || "Kunne ikke laste kunngjøringer"} />;
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
                </article>
            ))}
        </div>
    );
}

// Emne-visning
function EmneVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasCourses(harCanvasToken);
    const [valgtEmneId, settValgtEmneId] = useState<number | null>(null);
    const [valgtEmneVisning, settValgtEmneVisning] = useState<"modules" | "files" | "frontpage">("frontpage");
    const [valgtSide, settValgtSide] = useState<{ pageId: string; courseId: number } | null>(null);
    const modulerQuery = useCanvasModules(valgtEmneId, harCanvasToken);
    const filerQuery = useCanvasFiles(valgtEmneId, harCanvasToken);
    const siderQuery = useCanvasPages(valgtEmneId, harCanvasToken);
    const frontPageQuery = useCanvasFrontPage(valgtEmneId, harCanvasToken);

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
        return <FeilMelding melding={error?.message || "Kunne ikke laste emner"} />;
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

                <div className="mb-4 flex gap-2">
                    <button
                        onClick={() => settValgtEmneVisning("frontpage")}
                        className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "frontpage" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                    >
                        Se forside
                    </button>
                    <button
                        onClick={() => settValgtEmneVisning("modules")}
                        className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "modules" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                    >
                        Se moduler
                    </button>
                    <button
                        onClick={() => settValgtEmneVisning("files")}
                        className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "files" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                    >
                        Se filer
                    </button>
                </div>

                {valgtEmneVisning === "frontpage" && (
                    <div className="space-y-3">
                        {frontPageQuery.isLoading && (
                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Loader2 size={16} className="animate-spin" />
                                Laster forside...
                            </div>
                        )}
                        {frontPageQuery.isError && (
                            <FeilMelding melding={frontPageQuery.error?.message || "Kunne ikke laste forside"} />
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

                                        // Direkt nedlastingssti for filer (samme origin)
                                        const downloadPath = isFile && item.content_id
                                            ? `/api/canvas/filer/${item.content_id}/download`
                                            : undefined;

                                        // Direktelenker for andre typer
                                        const directUrl = isExternal
                                            ? sikkerHref(item.external_url)
                                            : sikkerHref(item.html_url);

                                        // Håndter klikk på item
                                        const handleClick = async (e: React.MouseEvent) => {
                                            if (isPage && item.page_url) {
                                                e.preventDefault();
                                                settValgtSide({ pageId: item.page_url, courseId: valgtEmneId });
                                                return;
                                            }
                                            if (isFile && downloadPath) {
                                                e.preventDefault();
                                                window.open(downloadPath, "_blank", "noopener,noreferrer");
                                            }
                                        };

                                        // Render item
                                        return (
                                            <a
                                                key={item.id}
                                                href={downloadPath || directUrl}
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
                                    {filerQuery.data.map((f) => (
                                        <a
                                            key={f.id}
                                            href={`/api/canvas/filer/${f.id}/download`}
                                            className="flex px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 items-center gap-2"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <Download size={16} className="text-slate-400" />
                                            <span>{f.display_name || f.filename}</span>
                                        </a>
                                    ))}
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
                        {filerQuery.data && filerQuery.data.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Dette emnet har ingen filer å vise.</p>
                        )}
                        {filerQuery.data && filerQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    Filer
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {filerQuery.data.map((f) => (
                                        <a
                                            key={f.id}
                                            href={`/api/canvas/filer/${f.id}/download`}
                                            className="flex px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 items-center gap-2"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <Download size={16} className="text-slate-400" />
                                            <span>{f.display_name || f.filename}</span>
                                        </a>
                                    ))}
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
                {data.courses.map((emne) => (
                <div
                    key={emne.id}
                    className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group cursor-pointer"
                    onClick={() => { settValgtEmneId(emne.id); settValgtEmneVisning("frontpage"); }}
                >
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {emne.name}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                        {emne.course_code}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("frontpage"); }}
                            className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                        >
                            Se forside
                            <ChevronRight size={16} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("modules"); }}
                            className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                        >
                            Se moduler
                            <ChevronRight size={16} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); settValgtEmneId(emne.id); settValgtEmneVisning("files"); }}
                            className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                        >
                            Se filer
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
                ))}
            </div>
        );
    }

// Data Visning
function DataVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasUser(harCanvasToken);

    if (!harCanvasToken) {
        return <FeilMelding melding="Du må lagre en Canvas API-token før du kan hente Canvas-data." />;
    }

    if (isLoading) {
        return (
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                <LasteSkjelett linjer={5} />
            </div>
        );
    }

    if (isError) {
        return <FeilMelding melding={error?.message || "Kunne ikke laste data"} />;
    }

    return (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                Din Canvas-data
            </h3>
            <pre className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg overflow-auto text-xs font-mono text-slate-700 dark:text-slate-300 max-h-125">
                {JSON.stringify(data, null, 2)}
            </pre>
        </div>
    );
}

// Hovedkomponent
export function CanvasSection({ startVisning = "announcements", harCanvasToken = false }: CanvasSectionProps) {
    const [visning, settVisning] = useState<CanvasVisning>(startVisning);

    // Oppdater visning hvis startVisning endres
    useEffect(() => {
        settVisning(startVisning);
    }, [startVisning]);

    const visningTitler: Record<CanvasVisning, string> = {
        announcements: "Kunngjøringer",
        courses: "Mine emner",
        data: "Canvas data",
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {visningTitler[visning]}
                </h2>
            </div>

            {/* Innhold */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {visning === "announcements" && <KunngjoringVisning harCanvasToken={harCanvasToken} />}
                {visning === "courses" && <EmneVisning harCanvasToken={harCanvasToken} />}
                {visning === "data" && <DataVisning harCanvasToken={harCanvasToken} />}
            </div>
        </div>
    );
}  
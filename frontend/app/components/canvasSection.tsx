/*
 * CanvasSection - Canvas visning
 * Viser kunngjøringer, emner og moduler fra Canvas LMS
 */
"use client";

import { useState, useEffect } from "react";
import {
    useCanvasAnnouncements,
    useCanvasEmner,
    useCanvasModules,
    useCanvasUser,
} from "../canvas/canvas-api";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import DOMPurify from "isomorphic-dompurify";
import parse, { DOMNode, Element } from "html-react-parser";
import {
    ArrowLeft,
    ChevronRight,
    ExternalLink,
    FileText,
    Loader2,
    AlertCircle,
} from "lucide-react";

// Typer for Canvas visninger
type CanvasView = "announcements" | "courses" | "data";

interface CanvasSectionProps {
    initialView?: CanvasView;
}

// Validering mot DOM-basert XSS - tillater kun http/https for href
const safeHref = (u?: string | null) => (u && u.startsWith("http") ? u : "#");

// Custom Image komponent med loading state
const CustomImage = ({
    src,
    alt,
    ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const [isLoading, setIsLoading] = useState(true);

    return (
        <span className="relative my-3 inline-block overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            {isLoading && (
                <span className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-700" />
            )}
            <img
                src={src}
                alt={alt}
                {...props}
                className={`transition-opacity duration-500 ${isLoading ? "opacity-0" : "opacity-100"} max-w-full max-h-75 w-auto h-auto object-contain`}
                onLoad={() => setIsLoading(false)}
                loading="lazy"
            />
        </span>
    );
};

// HTML parser options for safe rendering
const htmlParseOptions = {
    replace: (domNode: DOMNode) => {
        if (domNode instanceof Element) {
            if (domNode.tagName === "a") {
                const href = domNode.attribs?.href;
                return (
                    <a
                        href={safeHref(href)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                        {
                            // @ts-expect-error: html-react-parser types are loose here
                            domNode.children?.[0]?.data || ""
                        }
                        <ExternalLink size={12} className="opacity-50" />
                    </a>
                );
            }
            if (domNode.tagName === "img") {
                return (
                    <CustomImage
                        src={domNode.attribs.src}
                        alt={domNode.attribs.alt || "Canvas bilde"}
                        {...domNode.attribs}
                    />
                );
            }
        }
    },
};

// Loading Skeleton
function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
    return (
        <div className="space-y-3 animate-pulse">
            {Array.from({ length: lines }).map((_, i) => (
                <div
                    key={i}
                    className="h-4 bg-slate-200 dark:bg-slate-700 rounded"
                    style={{ width: `${85 - i * 15}%` }}
                />
            ))}
        </div>
    );
}

// Error melding komponent
function ErrorMessage({ message }: { message: string }) {
    return (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
        </div>
    );
}

// Announcements View
function AnnouncementsView() {
    const { data, isLoading, isError, error } = useCanvasAnnouncements();

    if (isLoading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <LoadingSkeleton />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return <ErrorMessage message={error?.message || "Kunne ikke laste kunngjøringer"} />;
    }

    if (!data?.announcements?.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">Ingen kunngjøringer</p>
            </div>
        );
    }

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
                            {parse(DOMPurify.sanitize(announcement.message), htmlParseOptions)}
                        </div>
                    )}
                </article>
            ))}
        </div>
    );
}

// Courses View
function CoursesView() {
    const { data, isLoading, isError, error } = useCanvasEmner();
    const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
    const modulesQuery = useCanvasModules(selectedCourseId);

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <LoadingSkeleton lines={2} />
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return <ErrorMessage message={error?.message || "Kunne ikke laste emner"} />;
    }

    // Vis moduler for valgt emne
    if (selectedCourseId) {
        const course = data?.emner.find((e) => e.id === selectedCourseId);

        return (
            <div>
                <button
                    onClick={() => setSelectedCourseId(null)}
                    className="flex items-center gap-2 mb-6 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <ArrowLeft size={16} />
                    Tilbake til emner
                </button>

                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                    {course?.name}
                </h3>

                {modulesQuery.isLoading && (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <Loader2 size={16} className="animate-spin" />
                        Laster moduler...
                    </div>
                )}

                {modulesQuery.isError && (
                    <ErrorMessage message={modulesQuery.error?.message || "Kunne ikke laste moduler"} />
                )}

                {modulesQuery.data?.modules && (
                    <div className="space-y-4">
                        {modulesQuery.data.modules.map((module) => (
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
                                    {module.items?.map((item) => (
                                        <a
                                            key={item.id}
                                            href={safeHref(item.html_url)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                                        >
                                            <FileText
                                                size={16}
                                                className="text-slate-400 dark:text-slate-500 shrink-0"
                                            />
                                            <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white truncate">
                                                {item.title}
                                            </span>
                                            <ExternalLink
                                                size={14}
                                                className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 shrink-0"
                                            />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Vis emner liste
    if (!data?.emner?.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">Ingen emner funnet</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.emner.map((emne) => (
                <button
                    key={emne.id}
                    onClick={() => setSelectedCourseId(emne.id)}
                    className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all group"
                >
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {emne.name}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                        {emne.course_code}
                    </p>
                    <div className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium">
                        Se moduler
                        <ChevronRight size={16} />
                    </div>
                </button>
            ))}
        </div>
    );
}

// Data View
function DataView() {
    const { data, isLoading, isError, error } = useCanvasUser();

    if (isLoading) {
        return (
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                <LoadingSkeleton lines={5} />
            </div>
        );
    }

    if (isError) {
        return <ErrorMessage message={error?.message || "Kunne ikke laste data"} />;
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
export function CanvasSection({ initialView = "announcements" }: CanvasSectionProps) {
    const [view, setView] = useState<CanvasView>(initialView);

    // Oppdater view hvis initialView endres
    useEffect(() => {
        setView(initialView);
    }, [initialView]);

    const viewTitles: Record<CanvasView, string> = {
        announcements: "Kunngjøringer",
        courses: "Mine emner",
        data: "Canvas data",
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {viewTitles[view]}
                </h2>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {view === "announcements" && <AnnouncementsView />}
                {view === "courses" && <CoursesView />}
                {view === "data" && <DataView />}
            </div>
        </div>
    );
}

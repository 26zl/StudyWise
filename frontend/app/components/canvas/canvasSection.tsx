/*
 * CanvasSection - Canvas visning
 * Viser kunngjøringer, emner og moduler fra Canvas LMS
 * Håndterer datahenting, visning og navigasjon innen Canvas-seksjonen
 */
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    ExternalLink,
    FileText,
    Download,
    BookOpen,
    Megaphone,
    ClipboardList,
} from "lucide-react";
import { LoadingView } from "@/app/components/ui/Loading";
import { CourseKnowledgePanel } from "@/app/components/ki/CourseKnowledgePanel";
import { fetchApi, downloadAuthedFile } from "@/app/lib/apiClient";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { CanvasTokenNotice } from "@/app/components/canvas/CanvasTokenNotice";
import {
    useCanvasAnnouncements,
    useCanvasCourseAnnouncements,
    useCanvasCourses,
    useCanvasModules,
    useCanvasFiles,
    useCanvasPages,
    useCanvasFrontPage,
    useCoursesMetadata,
    useCanvasAllAssignments,
    openModuleItem,
    type CourseContentMetadata,
    type AssignmentMedEmne,
} from "@/app/canvas/canvas-api";
import { useUIStore } from "@/app/store/uiStore";
import { CanvasKIHandlinger } from "@/app/components/ki/CanvasKIActions";
import { showToast } from "@/app/components/ui/Toaster";
import { erInnlevert as erInnlevertOppgave } from "@/app/canvas/canvasUtils";
import { useManuellInnlevering } from "@/app/hooks/useManuellInnlevering";
import { sikkerFilNedlastingUrl } from "@/app/canvas/canvasHtml";
import { CanvasPageVisning } from "@/app/components/canvas/CanvasPageVisning";
import { CanvasHtmlContent } from "@/app/components/canvas/CanvasHtmlContent";
import { useCanvasLabels, type CanvasVisning } from "@/app/components/canvas/canvasLabels";
import { lagBrukervennligFeilmelding } from "@/app/lib/errorUtils";
import { formaterDatoLong, formaterDatoMedTid, dagerFraIdag, formaterDagerRelativtFrist } from "@/app/lib/dato";
import { useMeg, useOppdaterHiddenCourses, useHiddenCourseIds } from "@/app/auth/auth-api";
import { useLanguage } from "@/app/i18n";
import type { CanvasFile } from "common/canvas";

// Felles filliste brukt i både modulvisning og filvisning
function FilListe({ filer, overskrift }: { filer: CanvasFile[]; overskrift: string }) {
    const { t } = useLanguage();
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                {overskrift}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filer.map((f) => {
                    const filUrl = sikkerFilNedlastingUrl(f.id);
                    if (!filUrl) return null;
                    return (
                        <button
                            type="button"
                            key={f.id}
                            onClick={() => {
                                void downloadAuthedFile(filUrl, f.display_name || f.filename).catch(() => {
                                    showToast.error(t("errors.generic.download"));
                                });
                            }}
                            className="flex w-full text-left px-4 py-3 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-slate-800 dark:text-slate-200 items-center gap-2"
                        >
                            <Download size={16} className="text-slate-400" />
                            <span>{f.display_name || f.filename}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Props for CanvasSection komponent
interface CanvasSectionProps {
    startVisning?: CanvasVisning;
    harCanvasToken?: boolean;
}

const PAGE_SIZE = 12;

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

// Kunngjørings-visning
function KunngjoringVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasAnnouncements(harCanvasToken);
    const { labels, dateLocale } = useCanvasLabels();
    const hiddenSet = useHiddenCourseIds();
    const megKunngjoring = useMeg();
    const canvasBaseUrl = megKunngjoring.data?.user?.canvasBaseUrl ?? undefined;
    const [offset, setOffset] = useState(0);
    const announcements = useMemo(() => {
        const alle = data?.announcements ?? [];
        if (hiddenSet.size === 0) return alle;
        return alle.filter((a) => {
            const match = a.context_code?.match(/^course_(\d+)$/);
            if (!match) return true;
            return !hiddenSet.has(Number(match[1]));
        });
    }, [data?.announcements, hiddenSet]);

    const totalElementer = announcements.length;
    const synligeElementer = useMemo(
        () => announcements.slice(offset, offset + PAGE_SIZE),
        [announcements, offset],
    );
    const harForrigeSide = offset > 0;
    const harNesteSide = offset + PAGE_SIZE < totalElementer;
    const fraElement = totalElementer === 0 ? 0 : offset + 1;
    const tilElement = Math.min(offset + PAGE_SIZE, totalElementer);

    useEffect(() => {
        setOffset(0);
    }, [announcements.length]);

    if (!harCanvasToken) {
        return <CanvasTokenNotice />;
    }

    if (isLoading) {
        return <LoadingView text={labels.announcementsLoading} fullPage={false} />;
    }

    if (isError) {
        return <FeilMelding melding={lagBrukervennligFeilmelding(error instanceof Error ? error : null, { canvas: true }, labels.announcementsLoadError)} />;
    }

    if (!announcements.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">{labels.announcementsEmpty}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {synligeElementer.map((announcement) => (
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
                                    locale: dateLocale,
                                })}
                            </time>
                        )}
                    </header>

                    {announcement.message && (
                        <CanvasHtmlContent
                            html={announcement.message}
                            className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-300"
                            canvasBaseUrl={canvasBaseUrl}
                        />
                    )}

                    {announcement.message && (
                        <CanvasKIHandlinger
                            tekst={announcement.message}
                            storrelse="md"
                            kildetype="announcement"
                            tittel={announcement.title}
                        />
                    )}
                </article>
            ))}
            {totalElementer > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 text-sm text-slate-500 dark:text-slate-400">
                    <span>
                        {fraElement}–{tilElement} / {totalElementer}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setOffset((c) => Math.max(0, c - PAGE_SIZE))}
                            disabled={!harForrigeSide}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                            {labels.previousPage}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOffset((c) => Math.min(c + PAGE_SIZE, Math.max(0, totalElementer - PAGE_SIZE)))}
                            disabled={!harNesteSide}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {labels.nextPage}
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Emne-visning
type EmneTab = "courses" | "hidden";

function EmneVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const { data, isLoading, isError, error } = useCanvasCourses(harCanvasToken);
    const metadataQuery = useCoursesMetadata(harCanvasToken);
    const { labels, language } = useCanvasLabels();
    const [valgtEmneId, settValgtEmneId] = useState<number | null>(null);
    const [valgtEmneVisning, settValgtEmneVisning] = useState<"modules" | "files" | "frontpage" | "pages" | "announcements">("frontpage");
    const [valgtSide, settValgtSide] = useState<{ pageId: string; courseId: number } | null>(null);
    const [aktivTab, settAktivTab] = useState<EmneTab>("courses");

    // Trigger prioritert Canvas-sync når bruker åpner et kurs.
    // Resultatet bryr vi oss ikke om — det skjer i bakgrunnen, og KI bruker dataene
    // ved neste chat-spørsmål. Stille feilhåndtering: ikke bra hvis dette plager brukeren.
    useEffect(() => {
        if (valgtEmneId == null) return;
        void fetchApi("/api/canvas/sync/prioritize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId: valgtEmneId }),
        }).catch(() => {});
    }, [valgtEmneId]);

    // Skjulte emner
    const megQuery = useMeg();
    const oppdaterHiddenCourses = useOppdaterHiddenCourses();
    const hiddenIds = megQuery.data?.user?.hiddenCourseIds?.courseIds ?? [];
    const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const canvasBaseUrl = megQuery.data?.user?.canvasBaseUrl ?? undefined;

    const skjulEmne = useCallback((courseId: number) => {
        const nyeIds = Array.from(new Set([...hiddenIds, courseId]));
        oppdaterHiddenCourses.mutate({ courseIds: nyeIds }, {
            onSuccess: () => showToast.success(labels.courseHidden),
            onError: (err) => {
                showToast.error(labels.hideCourse, err instanceof Error ? err.message : "");
            },
        });
    }, [hiddenIds, oppdaterHiddenCourses, labels.courseHidden, labels.hideCourse]);

    const visEmne = useCallback((courseId: number) => {
        const nyeIds = hiddenIds.filter((id) => id !== courseId);
        oppdaterHiddenCourses.mutate({ courseIds: nyeIds }, {
            onSuccess: () => {
                showToast.success(labels.courseShown);
                // Bytt tilbake til courses-tab hvis dette var siste skjulte emne
                if (nyeIds.length === 0) {
                    settAktivTab("courses");
                }
            },
            onError: (err) => {
                showToast.error(labels.showCourse, err instanceof Error ? err.message : "");
            },
        });
    }, [hiddenIds, oppdaterHiddenCourses, labels.courseShown, labels.showCourse]);

    const synligeEmner = useMemo(
        () => data?.courses?.filter((c) => !hiddenSet.has(c.id)) ?? [],
        [data?.courses, hiddenSet],
    );
    const skjulteEmner = useMemo(
        () => data?.courses?.filter((c) => hiddenSet.has(c.id)) ?? [],
        [data?.courses, hiddenSet],
    );

    // Hent metadata for et emne (med fallback til "ukjent" hvis ikke lastet)
    const getMetadata = (courseId: number): CourseContentMetadata | null => {
        if (!metadataQuery.data?.metadata) return null;
        return metadataQuery.data.metadata[String(courseId)] || null;
    };

    // Beregn om queries skal være aktivert basert på metadata
    // Dette forhindrer unødvendige API-kall for innhold som ikke finnes eller brukeren ikke har tilgang til
    const valgtMeta = valgtEmneId ? getMetadata(valgtEmneId) : null;
    const metaReady = !metadataQuery.isLoading && !!metadataQuery.data?.metadata;

    // Metadata brukes som hint i UI, men skal ikke kunne sperre innhold hvis den er ufullstendig/stale.
    const valgtEmneAktivert = harCanvasToken && !!valgtEmneId;
    const modulerQuery = useCanvasModules(valgtEmneId, valgtEmneAktivert);
    const filerQuery = useCanvasFiles(valgtEmneId, valgtEmneAktivert);
    const siderQuery = useCanvasPages(valgtEmneId, valgtEmneAktivert);
    const frontPageQuery = useCanvasFrontPage(valgtEmneId, valgtEmneAktivert);
    const emneKunngjoringerQuery = useCanvasCourseAnnouncements(
        valgtEmneId,
        valgtEmneAktivert,
    );

    if (!harCanvasToken) {
        return <CanvasTokenNotice />;
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
        return <FeilMelding melding={lagBrukervennligFeilmelding(error instanceof Error ? error : null, { canvas: true }, labels.coursesLoadError)} />;
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
                    type="button"
                    onClick={() => settValgtEmneId(null)}
                    className="flex items-center gap-2 mb-6 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <ArrowLeft size={16} />
                    {labels.backToCourses}
                </button>

                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                    {course?.name}
                </h3>

                {megQuery.data?.user?.role === "admin" && (
                    <div className="mb-4">
                        <CourseKnowledgePanel courseId={valgtEmneId} />
                    </div>
                )}

                {/* Vis tabs kun for innhold som finnes */}
                {(() => {
                    const meta = getMetadata(valgtEmneId);
                    const metadataLaster = metadataQuery.isLoading;
                    const harForsideData = !!frontPageQuery.data;
                    const harModulerData = (modulerQuery.data?.modules?.length ?? 0) > 0;
                    const harSiderData = (siderQuery.data?.length ?? 0) > 0;
                    const harFilerData = (filerQuery.data?.length ?? 0) > 0;
                    const visForsideTab = metadataLaster || !meta || meta.hasFrontPage || harForsideData || valgtEmneVisning === "frontpage";
                    const visModulerTab = metadataLaster || !meta || meta.hasModules || harModulerData || valgtEmneVisning === "modules";
                    const visSiderTab = metadataLaster || !meta || meta.hasPages || harSiderData || valgtEmneVisning === "pages";
                    const visFilerTab = metadataLaster || !meta || meta.hasFiles || harFilerData || valgtEmneVisning === "files";

                    return (
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                            {visForsideTab && (
                                <button
                                    type="button"
                                    onClick={() => settValgtEmneVisning("frontpage")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "frontpage" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    {labels.frontPage}
                                </button>
                            )}
                            {visModulerTab && (
                                <button
                                    type="button"
                                    onClick={() => settValgtEmneVisning("modules")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "modules" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    {labels.modules}{meta?.modulesCount ? ` (${meta.modulesCount})` : ""}
                                </button>
                            )}
                            {visSiderTab && (
                                <button
                                    type="button"
                                    onClick={() => settValgtEmneVisning("pages")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "pages" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    {labels.pages}{meta?.pagesCount ? ` (${meta.pagesCount})` : ""}
                                </button>
                            )}
                            {visFilerTab && (
                                <button
                                    type="button"
                                    onClick={() => settValgtEmneVisning("files")}
                                    className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "files" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                                >
                                    {labels.files}{meta?.filesCount ? ` (${meta.filesCount})` : ""}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => settValgtEmneVisning("announcements")}
                                className={`px-3 py-1 rounded-lg text-sm border ${valgtEmneVisning === "announcements" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"}`}
                            >
                                {labels.courseAnnouncements}
                                {emneKunngjoringerQuery.data?.announcements?.length
                                    ? ` (${emneKunngjoringerQuery.data.announcements.length})`
                                    : ""}
                            </button>
                        </div>
                    );
                })()}

                {valgtEmneVisning === "announcements" && (
                    <div className="space-y-4">
                        {emneKunngjoringerQuery.isLoading && (
                            <LoadingView text={labels.courseAnnouncementsLoading} fullPage={false} />
                        )}
                        {emneKunngjoringerQuery.isError && (
                            <FeilMelding
                                melding={lagBrukervennligFeilmelding(
                                    emneKunngjoringerQuery.error instanceof Error
                                        ? emneKunngjoringerQuery.error
                                        : null,
                                    { canvas: true },
                                    labels.courseAnnouncementsError,
                                )}
                            />
                        )}
                        {!emneKunngjoringerQuery.isLoading &&
                            !emneKunngjoringerQuery.isError &&
                            (emneKunngjoringerQuery.data?.announcements?.length ?? 0) === 0 && (
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {labels.courseAnnouncementsEmpty}
                                </p>
                            )}
                        {(emneKunngjoringerQuery.data?.announcements ?? []).map((announcement) => (
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
                                            {formaterDatoMedTid(announcement.posted_at, language)}
                                        </time>
                                    )}
                                </header>

                                {announcement.message && (
                                    <CanvasHtmlContent
                                        html={announcement.message}
                                        className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-300"
                                        canvasBaseUrl={canvasBaseUrl}
                                    />
                                )}

                                {announcement.message && (
                                    <CanvasKIHandlinger
                                        tekst={announcement.message}
                                        storrelse="md"
                                        kildetype="announcement"
                                        tittel={announcement.title}
                                        emne={course?.name}
                                    />
                                )}
                            </article>
                        ))}
                    </div>
                )}

                {valgtEmneVisning === "frontpage" && (
                    <div className="space-y-3">
                        {frontPageQuery.isLoading && (
                            <LoadingView text={labels.frontPageLoading} fullPage={false} />
                        )}
                        {frontPageQuery.isError && (
                            <FeilMelding melding={lagBrukervennligFeilmelding(frontPageQuery.error instanceof Error ? frontPageQuery.error : null, { canvas: true }, labels.frontPageLoadError)} />
                        )}
                        {frontPageQuery.data && (
                            <article className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
                                <header className="mb-3 flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                                    <BookOpen size={18} /> {frontPageQuery.data.title || labels.frontPage}
                                </header>
                                {frontPageQuery.data.body ? (
                                    <CanvasHtmlContent
                                        html={frontPageQuery.data.body}
                                        className="min-w-0 overflow-x-auto prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 prose-table:block prose-table:overflow-x-auto prose-img:max-w-full prose-img:h-auto [&_iframe]:max-w-full"
                                        canvasBaseUrl={canvasBaseUrl}
                                    />
                                ) : (
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">{labels.frontPageEmpty}</p>
                                )}
                            </article>
                        )}
                        {!frontPageQuery.isLoading && !frontPageQuery.data && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.frontPageUnavailable}</p>
                        )}
                    </div>
                )}

                {valgtEmneVisning === "modules" && (
                    <>
                        {modulerQuery.isLoading && (
                    <LoadingView text={labels.modulesLoading} fullPage={false} />
                )}

                        {modulerQuery.isError && (
                            <FeilMelding melding={labels.modulesAccessError} />
                        )}

                        {/* Vis melding når query er disabled pga metadata sier ingen moduler */}
                        {!modulerQuery.isLoading && !modulerQuery.isError && !modulerQuery.data?.modules?.length && metaReady && valgtMeta?.hasModules === false && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.modulesEmpty}</p>
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

                                {/* KI-handlinger for denne modulen – oppsummering + direkte spørsmål til KI-chat */}
                                <div className="px-4 pt-1 pb-2">
                                    <CanvasKIHandlinger
                                        tekst={[
                                            `${labels.moduleLabel}: ${module.name}.`,
                                            course?.name ? `${labels.courseLabel}: ${course.name}.` : "",
                                            module.items?.length
                                                ? `${labels.contentLabel}: ${module.items.map((it) => it.title).filter(Boolean).join(", ")}.`
                                                : labels.noItems,
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                        storrelse="sm"
                                        kildetype="module"
                                        tittel={module.name}
                                        emne={course?.name}
                                    />
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
                                                void downloadAuthedFile(downloadPath, item.title).catch(() => {
                                                    showToast.error(
                                                        labels.openFileErrorTitle,
                                                        labels.openFileErrorDescription,
                                                    );
                                                });
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
                                                            void downloadAuthedFile(safeUrl, item.title).catch(() => {
                                                                showToast.error(
                                                                    labels.openFileErrorTitle,
                                                                    labels.openFileErrorDescription,
                                                                );
                                                            });
                                                            return;
                                                        }
                                                    }
                                                    showToast.error(
                                                        labels.openFileErrorTitle,
                                                        labels.openFileErrorDescription,
                                                    );
                                                } catch (err) {
                                                    showToast.error(
                                                        labels.openFileErrorTitle,
                                                        lagBrukervennligFeilmelding(
                                                            err instanceof Error ? err : null,
                                                            { canvas: true },
                                                            labels.retrySoon,
                                                        ),
                                                    );
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
                            <LoadingView text={labels.frontPageLoading} fullPage={false} />
                        )}

                        {frontPageQuery.data && (
                            <article className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
                                <header className="mb-3 flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                                    <BookOpen size={18} /> {labels.frontPage}
                                </header>
                                {frontPageQuery.data.body ? (
                                    <CanvasHtmlContent
                                        html={frontPageQuery.data.body}
                                        className="min-w-0 overflow-x-auto prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-700 dark:text-slate-200 prose-img:max-w-full prose-img:h-auto [&_iframe]:max-w-full"
                                        canvasBaseUrl={canvasBaseUrl}
                                    />
                                ) : (
                                    <p className="text-slate-500 dark:text-slate-400 text-sm">{labels.frontPageEmpty}</p>
                                )}
                            </article>
                        )}

                        {siderQuery.data && siderQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    {labels.pages}
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {siderQuery.data.map((p) => (
                                        <button
                                            key={p.url}
                                            type="button"
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
                            <FilListe filer={filerQuery.data} overskrift={labels.files} />
                        )}
                    </div>
                )}
                    </>
                )}

                {valgtEmneVisning === "pages" && (
                    <div className="space-y-3">
                        {siderQuery.isLoading && (
                            <LoadingView text={labels.pagesLoading} fullPage={false} />
                        )}
                        {siderQuery.isError && (
                            <FeilMelding melding={labels.pagesAccessError} />
                        )}
                        {!siderQuery.isLoading && !siderQuery.isError && !siderQuery.data && metaReady && valgtMeta?.hasPages === false && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.pagesEmpty}</p>
                        )}
                        {siderQuery.data && siderQuery.data.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.pagesNothingToShow}</p>
                        )}
                        {siderQuery.data && siderQuery.data.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white">
                                    {labels.pages}
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {siderQuery.data.map((p) => (
                                        <button
                                            key={p.url}
                                            type="button"
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
                    </div>
                )}

                {valgtEmneVisning === "files" && (
                    <div className="space-y-3">
                        {filerQuery.isLoading && (
                            <LoadingView text={labels.filesLoading} fullPage={false} />
                        )}
                        {filerQuery.isError && (
                            <FeilMelding melding={labels.filesAccessError} />
                        )}
                        {/* Vis melding når query er disabled pga metadata sier ingen filer */}
                        {!filerQuery.isLoading && !filerQuery.isError && !filerQuery.data && metaReady && valgtMeta?.hasFiles === false && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.filesEmpty}</p>
                        )}
                        {filerQuery.data && filerQuery.data.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.filesNothingToShow}</p>
                        )}
                        {filerQuery.data && filerQuery.data.length > 0 && (
                            <FilListe filer={filerQuery.data} overskrift={labels.files} />
                        )}
                    </div>
                )}
            </div>
        );
    }

    // Vis emner liste
    if (!synligeEmner.length && !skjulteEmner.length) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-500 dark:text-slate-400">{labels.noCourses}</p>
            </div>
        );
    }

    // Render emner med tabs
        return (
            <div className="space-y-4">
                {/* Tabs: Emner / Skjulte */}
                <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={() => settAktivTab("courses")}
                        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                            aktivTab === "courses"
                                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                    >
                        <BookOpen size={16} />
                        {labels.sectionTitles.courses}
                    </button>
                    {skjulteEmner.length > 0 && (
                        <button
                            type="button"
                            onClick={() => settAktivTab("hidden")}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                                aktivTab === "hidden"
                                    ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                                    : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                            }`}
                        >
                            <EyeOff size={16} />
                            {labels.hiddenCourses} ({skjulteEmner.length})
                        </button>
                    )}
                </div>

                {/* Skjulte emner tab */}
                {aktivTab === "hidden" && (
                    <>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{labels.hiddenCoursesDescription}</p>
                        {skjulteEmner.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-slate-500 dark:text-slate-400">{labels.hiddenCoursesEmpty}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {skjulteEmner.map((emne) => (
                                    <article
                                        key={emne.id}
                                        className="rounded-xl border border-slate-200 bg-white p-5 text-left transition-all dark:border-slate-700 dark:bg-slate-800/50 opacity-70"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">
                                                    {emne.name}
                                                </h3>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {emne.course_code}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => visEmne(emne.id)}
                                                title={labels.showCourse}
                                                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-blue-400 transition-colors"
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Synlige emner tab */}
                {aktivTab === "courses" && (
                    <>

                {synligeEmner.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 dark:text-slate-400">{labels.noCourses}</p>
                    </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {synligeEmner.map((emne) => {
                    const meta = getMetadata(emne.id);
                    const metadataLaster = metadataQuery.isLoading;

                    // Bestem hvilken visning som skal være default basert på metadata
                    const velgDefaultVisning = (): "frontpage" | "modules" | "files" | "pages" => {
                        if (!meta) return "modules"; // Moduler-visningen har innebygget fallback til sider/filer/forside
                        if (meta.hasFrontPage) return "frontpage";
                        if (meta.hasModules) return "modules";
                        if (meta.hasPages) return "pages";
                        if (meta.hasFiles) return "files";
                        return "modules";
                    };

                    // Metadata er kun hint. Hvis den sier "ingen innhold" for ALT, kan det skyldes at Canvas API-kall feilet.
                    // I så fall viser vi alle knapper uten antall, slik at brukeren alltid kan navigere til innholdet.
                    const metadataHarIngenData = meta && !meta.hasFrontPage && !meta.hasModules && !meta.hasPages && !meta.hasFiles;
                    const visForsideKnapp = !meta || meta.hasFrontPage || metadataHarIngenData;
                    const visModulerKnapp = !meta || meta.hasModules || metadataHarIngenData;
                    const visSiderKnapp = !meta || meta.hasPages;
                    const visFilerKnapp = !meta || meta.hasFiles;
                    const visEmnekunngjoringerKnapp = true;
                    const åpneEmne = (visning: "frontpage" | "modules" | "files" | "pages" | "announcements") => {
                        settValgtEmneId(emne.id);
                        settValgtEmneVisning(visning);
                    };

                    return (
                        <article
                            key={emne.id}
                            className="rounded-xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600"
                        >
                            <div className="flex items-start gap-2">
                                <button
                                    type="button"
                                    onClick={() => åpneEmne(velgDefaultVisning())}
                                    className="group block flex-1 min-w-0 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                                    aria-label={`Åpne emnet ${emne.name}`}
                                >
                                    <h3 className="mb-1 font-semibold text-slate-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                                        {emne.name}
                                    </h3>
                                    <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                                        {emne.course_code}
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => skjulEmne(emne.id)}
                                    title={labels.hideCourse}
                                    className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors"
                                >
                                    <EyeOff size={16} />
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2" aria-label={`Tilgjengelig innhold i ${emne.name}`}>
                                {metadataLaster ? (
                                    <>
                                        <div className="h-6 w-16 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="h-6 w-20 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="h-6 w-14 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                        <div className="h-6 w-28 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                                    </>
                                ) : (
                                    <>
                                        {visForsideKnapp && (
                                            <button
                                                type="button"
                                                onClick={() => åpneEmne("frontpage")}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                {labels.frontPage}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visModulerKnapp && (
                                            <button
                                                type="button"
                                                onClick={() => åpneEmne("modules")}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                {labels.modules}{meta?.modulesCount ? ` (${meta.modulesCount})` : ""}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visSiderKnapp && (
                                            <button
                                                type="button"
                                                onClick={() => åpneEmne("pages")}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                {labels.pages}{meta?.pagesCount ? ` (${meta.pagesCount})` : ""}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visFilerKnapp && (
                                            <button
                                                type="button"
                                                onClick={() => åpneEmne("files")}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                {labels.files}{meta?.filesCount ? ` (${meta.filesCount})` : ""}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                        {visEmnekunngjoringerKnapp && (
                                            <button
                                                type="button"
                                                onClick={() => åpneEmne("announcements")}
                                                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                            >
                                                {labels.courseAnnouncements}
                                                <ChevronRight size={16} />
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
                )}
                    </>
                )}
            </div>
        );
    }

// Advarsel når Canvas-token er ugyldig/slettet
function TokenUgyldigAdvarsel() {
    return (
        <CanvasTokenNotice variant="invalid" className="mx-4 mt-4 md:mx-6" />
    );
}

// Hovedkomponent
export function CanvasSection({ startVisning = "announcements", harCanvasToken = false }: CanvasSectionProps) {
    const [visning, settVisning] = useState<CanvasVisning>(startVisning);
    const canvasTokenInvalid = useUIStore((state) => state.canvasTokenInvalid);
    const { labels } = useCanvasLabels();

    // Oppdater visning hvis startVisning endres
    useEffect(() => {
        settVisning(startVisning);
    }, [startVisning]);

    const erSentrert = visning === "announcements" || visning === "assignments";
    const visningIkon = visning === "announcements"
        ? <Megaphone className="w-6 h-6 text-slate-700 dark:text-slate-300" />
        : visning === "assignments"
            ? <ClipboardList className="w-6 h-6 text-slate-700 dark:text-slate-300" />
            : null;

    if (erSentrert) {
        return (
            <div className="min-h-full">
                <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-3">
                            {visningIkon}
                            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white">
                                {labels.sectionTitles[visning]}
                            </h1>
                        </div>
                    </div>
                </div>

                {canvasTokenInvalid && <TokenUgyldigAdvarsel />}

                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    {canvasTokenInvalid ? null : (
                        <>
                            {visning === "announcements" && <KunngjoringVisning harCanvasToken={harCanvasToken} />}
                            {visning === "assignments" && <OppgaverVisning harCanvasToken={harCanvasToken} />}
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {labels.sectionTitles[visning]}
                </h2>
            </div>

            {canvasTokenInvalid && <TokenUgyldigAdvarsel />}

            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {canvasTokenInvalid ? null : (
                    <>{visning === "courses" && <EmneVisning harCanvasToken={harCanvasToken} />}</>
                )}
            </div>
        </div>
    );
}

// Oppgave-visning - alle oppgaver på tvers av emner
function OppgaverVisning({ harCanvasToken }: { harCanvasToken: boolean }) {
    const assignmentsQuery = useCanvasAllAssignments({ enabled: harCanvasToken });
    const hiddenSet = useHiddenCourseIds();
    const allAssignments: AssignmentMedEmne[] = useMemo(() => {
        const alle = assignmentsQuery.data || [];
        if (hiddenSet.size === 0) return alle;
        return alle.filter((a) => a.course_id == null || !hiddenSet.has(a.course_id));
    }, [assignmentsQuery.data, hiddenSet]);
    const { language, labels } = useCanvasLabels();
    const { ferdigeIdSet, toggleFerdig } = useManuellInnlevering();

    const [filter, settFilter] = useState<"alle" | "kommende" | "forfalt" | "uten-frist" | "innlevert">("kommende");
    const [sortering, settSortering] = useState<"frist" | "emne">("frist");
    const [offset, setOffset] = useState(0);

    const filtrerteOppgaver = useMemo(() => {
        const nå = new Date();
        let filtrert = [...allAssignments];

        if (filter === "kommende") {
            filtrert = filtrert.filter((a) => a.due_at && new Date(a.due_at) >= nå);
        } else if (filter === "forfalt") {
            filtrert = filtrert.filter((a) => a.due_at && new Date(a.due_at) < nå);
        } else if (filter === "uten-frist") {
            filtrert = filtrert.filter((a) => !a.due_at);
        } else if (filter === "innlevert") {
            filtrert = filtrert.filter((a) => erInnlevertOppgave(a) || ferdigeIdSet.has(a.id));
        }

        if (sortering === "frist") {
            const nyestFørst = filter === "innlevert" || filter === "forfalt";
            filtrert.sort((a, b) => {
                if (!a.due_at && !b.due_at) return 0;
                if (!a.due_at) return 1;
                if (!b.due_at) return -1;
                const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
                return nyestFørst ? -diff : diff;
            });
        } else {
            filtrert.sort((a, b) => a.course_name.localeCompare(b.course_name, language === "en" ? "en" : "nb"));
        }

        return filtrert;
    }, [allAssignments, filter, ferdigeIdSet, language, sortering]);

    const totalElementer = filtrerteOppgaver.length;
    const synligeOppgaver = useMemo(
        () => filtrerteOppgaver.slice(offset, offset + PAGE_SIZE),
        [filtrerteOppgaver, offset],
    );
    const harForrigeSide = offset > 0;
    const harNesteSide = offset + PAGE_SIZE < totalElementer;
    const fraElement = totalElementer === 0 ? 0 : offset + 1;
    const tilElement = Math.min(offset + PAGE_SIZE, totalElementer);

    useEffect(() => {
        setOffset(0);
    }, [filter, sortering]);

    useEffect(() => {
        if (totalElementer === 0) {
            if (offset !== 0) setOffset(0);
            return;
        }
        if (offset >= totalElementer) {
            setOffset(Math.floor((totalElementer - 1) / PAGE_SIZE) * PAGE_SIZE);
        }
    }, [offset, totalElementer]);

    if (!harCanvasToken) {
        return <CanvasTokenNotice />;
    }

    if (assignmentsQuery.isLoading) {
        return (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-8">
                <LoadingView text={labels.assignmentsLoading} fullPage={false} />
            </div>
        );
    }

    if (assignmentsQuery.isError) {
        return (
            <FeilMelding
                melding={lagBrukervennligFeilmelding(
                    assignmentsQuery.error instanceof Error ? assignmentsQuery.error : null,
                    { canvas: true },
                    labels.assignmentsLoadError,
                )}
            />
        );
    }

    if (allAssignments.length === 0) {
        return (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {labels.assignmentsEmptyTitle} {labels.assignmentsEmptyDescription}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">
                    {labels.showingAssignments(filtrerteOppgaver.length, allAssignments.length)}
                </span>
                <div className="flex-1" />
                <div className="flex flex-wrap gap-2 text-xs sm:text-sm">
                    {(["alle", "kommende", "forfalt", "uten-frist", "innlevert"] as const).map((f) => {
                        return (
                            <button
                                key={f}
                                type="button"
                                onClick={() => settFilter(f)}
                                className={`px-3 py-1 rounded-full border transition-colors ${
                                    filter === f
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                }`}
                            >
                                {labels.assignmentFilters[f]}
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() => settSortering(sortering === "frist" ? "emne" : "frist")}
                        className="px-3 py-1 rounded-full border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        {sortering === "frist" ? labels.sortByDue : labels.sortByCourse}
                    </button>
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 divide-y divide-slate-200 dark:divide-slate-700">
                {synligeOppgaver.map((assignment) => {
                    const nå = new Date();
                    const harFrist = !!assignment.due_at;
                    const fristDato = harFrist ? new Date(assignment.due_at!) : null;
                    const erForfalt = fristDato ? fristDato < nå : false;

                    const dagerTekst = fristDato ? formaterDagerRelativtFrist(dagerFraIdag(fristDato), language) : "";

                    const erInnlevert = erInnlevertOppgave(assignment);
                    const erManueltFerdig = ferdigeIdSet.has(assignment.id);
                    const erFerdig = erInnlevert || erManueltFerdig;

                    const oppsummeringstekst = [
                        assignment.name,
                        `${labels.assignmentCourse}: ${assignment.course_name}`,
                        erFerdig ? labels.submitted : "",
                        assignment.points_possible != null ? `${labels.points}: ${assignment.points_possible}` : "",
                        assignment.due_at ? `${labels.due}: ${formaterDatoLong(assignment.due_at, language)}` : "",
                    ].filter(Boolean).join(". ");

                    return (
                        <div
                            key={`${assignment.course_id}-${assignment.id}`}
                            className="px-4 py-3 flex flex-col gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    {!erInnlevert && (
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={erManueltFerdig}
                                            aria-label={erManueltFerdig ? labels.unmarkAsSubmitted : labels.markAsSubmitted}
                                            title={erManueltFerdig ? labels.unmarkAsSubmitted : labels.markAsSubmitted}
                                            onClick={() => toggleFerdig(assignment.id)}
                                            className={`mt-1 shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                                                erManueltFerdig
                                                    ? "bg-green-500 dark:bg-green-600 border-green-500 dark:border-green-600 text-white"
                                                    : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500"
                                            }`}
                                        >
                                            {erManueltFerdig && (
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <h3 className={`font-medium text-sm sm:text-base truncate ${erManueltFerdig ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
                                            {assignment.name}
                                        </h3>
                                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span>{assignment.course_name}</span>
                                            {assignment.points_possible != null ? (
                                                <span>· {assignment.points_possible} {labels.pointsSuffix}</span>
                                            ) : null}
                                            {erInnlevert && (
                                                <span className="inline-flex items-center rounded-md bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
                                                    {labels.submitted}
                                                </span>
                                            )}
                                            {erManueltFerdig && !erInnlevert && (
                                                <span className="inline-flex items-center rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                                    {labels.manuallySubmitted}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right shrink-0 text-xs sm:text-sm">
                                    {harFrist ? (
                                        <>
                                            <div
                                                className={`font-medium ${
                                                    erForfalt
                                                        ? "text-red-600 dark:text-red-400"
                                                        : "text-slate-700 dark:text-slate-300"
                                                }`}
                                            >
                                                {dagerTekst}
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                                {formaterDatoMedTid(fristDato!, language)}
                                            </div>
                                        </>
                                    ) : (
                                        <span className="italic text-slate-400 dark:text-slate-500">
                                            {labels.noDueDate}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <CanvasKIHandlinger
                                tekst={oppsummeringstekst}
                                storrelse="md"
                                kildetype="assignment"
                                tittel={assignment.name}
                                emne={assignment.course_name}
                            />
                        </div>
                    );
                })}
            </div>

            {totalElementer > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 text-sm text-slate-500 dark:text-slate-400">
                    <span>
                        {fraElement}–{tilElement} / {totalElementer}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setOffset((c) => Math.max(0, c - PAGE_SIZE))}
                            disabled={!harForrigeSide}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                            {labels.previousPage}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOffset((c) => Math.min(c + PAGE_SIZE, Math.max(0, totalElementer - PAGE_SIZE)))}
                            disabled={!harNesteSide}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {labels.nextPage}
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

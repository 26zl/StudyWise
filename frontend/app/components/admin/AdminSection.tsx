/**
 * AdminSection — Admin-panel med faner for statistikk, brukere og revisjonslogg.
 * Kun synlig for brukere med admin-rolle.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { isValidReportedErrorId } from "common/contact";
import {
  Users,
  BarChart3,
  ScrollText,
  Shield,
  ShieldCheck,
  Share2,
  Eye,
  Pin,
  Link,
  Mail,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Activity,
  AlertTriangle,
  Database,
  BookOpen,
  FileText,
  Library,
  Link2,
  RefreshCcw,
  UserX,
  Trash2,
  Check,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Bell,
  FileUp,
  Layers,
  PlayCircle,
  Server,
  Zap,
  Terminal,
  Pause,
  Play,
  Info,
  Unlock,
  Lock,
  LockOpen,
  LogOut,
  MailCheck,
  Send,
  Megaphone,
  Loader2,
  ShieldOff,
  Globe,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import type { Translator } from "@/app/i18n/types";
import { useMeg } from "@/app/auth/auth-api";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { showToast, toast } from "@/app/components/ui/Toaster";
import { formaterDatoLong, formaterDatoOgTid, formaterTall } from "@/app/lib/dato";
import { downloadAuthedFile, fetchApi } from "@/app/lib/apiClient";
import {
  useBackfillFullText,
  useAdminStats,
  useAdminCrawlerStats,
  useAdminRetrievalDebug,
  useAdminExtractionAudit,
  useAdminKbHealth,
  useAdminFeedbackTriage,
  useRetryFailedCrawls,
  useReindexMissingFiles,
  useReextractTruncatedFiles,
  useAdminBrukere,
  type AdminBrukereStatusFilter,
  useAdminAudit,
  useDailyMetrics,
  useLangsmithOverview,
  useRunDetail,
  useRuns,
  useEndreRolle,
  useSlettBruker,
  useLockUser,
  useUnlockUser,
  useRevokeUserSessions,
  useResendVerification,
  useResetUserMfa,
  useAdminBrukerDetalj,
  useAdminContactMessages,
  useUpdateContactMessageStatus,
  useDeleteContactMessage,
  useReplyContactMessage,
  useClearLangsmithCache,
  useQueueOverview,
  useQueueJobs,
  usePauseQueue,
  useRetryQueueJob,
  useRemoveQueueJob,
  useResumeQueue,
  useRedisInfo,
  useRedisPrefixes,
  useRedisFlushPrefix,
  useRedisRelinkStates,
  useClearRedisRelinkState,
  useAdminFeedback,
  useCleanupOrphaned,
  useRebuildEmbeddings,
  useForceCanvasResync,
  useCleanExpiredShares,
  useCleanOldChats,
  useMaintenanceStatus,
  useEncryptionStatus,
  useReencryptTokens,
  useDatabaseHealth,
  useDependenciesHealth,
  useAdminAnnouncement,
  usePublishAnnouncement,
  useClearAnnouncement,
} from "@/app/admin/admin-api";
import type {
  AdminAuditCategory,
  AdminBruker,
  AdminContactMessage,
  AdminFeedbackItem,
  AdminFeedbackRating,
  AdminQueueOverviewItem,
  AdminRedisPrefix,
  AdminRedisRelinkStateItem,
  AdminRetrievalDebugResponse,
  ContactMessageStatus,
  QueueJobStatus,
} from "@/app/admin/admin-api";

const GYLDIGE_ADMIN_FANER = [
  "stats",
  "observability",
  "queues",
  "redis",
  "users",
  "inbox",
  "audit",
  "logs",
  "feedback",
  "maintenance",
] as const;

type AdminFane = (typeof GYLDIGE_ADMIN_FANER)[number];
type LangsmithStatusFilter = "all" | "success" | "error";

type LangsmithRunRow = {
  id: string;
  timestamp: string;
  model: string;
  intent: string;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
};

function hentFeilmelding(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function visBekreftelsesToast({
  t,
  melding,
  handlingstekst,
  onBekreft,
}: {
  t: Translator;
  melding: string;
  handlingstekst: string;
  onBekreft: () => void;
}) {
  toast.warning(melding, {
    duration: 10_000,
    action: {
      label: handlingstekst,
      onClick: onBekreft,
    },
    cancel: {
      label: t("common.actions.cancel"),
      onClick: () => {},
    },
  });
}

// ── Statistikk-fane ─────────────────────────────────────────────────────────

type StatKortData = {
  label: string;
  verdi: number;
  ikon: React.ElementType;
  format?: "number" | "percent";
};

function formaterStatVerdi(
  verdi: number,
  language: "nb" | "en",
  format: StatKortData["format"] = "number",
): string {
  const formatted = formaterTall(verdi, language);
  return format === "percent" ? `${formatted} %` : formatted;
}

function StatKort({
  label,
  verdi,
  ikon: Ikon,
  language,
  format,
}: {
  label: string;
  verdi: number;
  ikon: React.ElementType;
  language: "nb" | "en";
  format?: StatKortData["format"];
}) {
  return (
    <div className="flex min-h-28 items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
        <Ikon size={20} className="text-slate-600 dark:text-slate-300" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-semibold text-slate-900 dark:text-white">
          {formaterStatVerdi(verdi, language, format)}
        </p>
        <p className="text-sm leading-5 text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function StatSeksjon({
  title,
  stats,
  language,
}: {
  title: string;
  stats: StatKortData[];
  language: "nb" | "en";
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatKort
            key={stat.label}
            label={stat.label}
            verdi={stat.verdi}
            ikon={stat.ikon}
            language={language}
            format={stat.format}
          />
        ))}
      </div>
    </section>
  );
}

function formaterBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function VedlikeholdKort({
  ikon: Ikon,
  tittel,
  beskrivelse,
  merknad,
  handlingTekst,
  onHandling,
  isPending,
  variant = "warning",
  children,
}: {
  ikon: React.ElementType;
  tittel: string;
  beskrivelse: string;
  merknad: string;
  handlingTekst: string;
  onHandling: () => void;
  isPending: boolean;
  variant?: "warning" | "danger";
  children?: React.ReactNode;
}) {
  const ikonBg =
    variant === "danger"
      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  const btnBg =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
      : "bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ikonBg}`}
          >
            <Ikon size={16} />
          </div>
          <button
            type="button"
            onClick={onHandling}
            disabled={isPending}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${btnBg}`}
          >
            <RefreshCcw size={12} className={isPending ? "animate-spin" : ""} />
            {handlingTekst}
          </button>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{tittel}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{beskrivelse}</p>
        </div>
        {children}
        <p className="text-[11px] text-slate-400 dark:text-slate-500">{merknad}</p>
      </div>
    </div>
  );
}

function MaintenanceFane() {
  const { language, t } = useLanguage();
  const backfillMutation = useBackfillFullText();
  const cleanupOrphanedMutation = useCleanupOrphaned();
  const rebuildEmbeddingsMutation = useRebuildEmbeddings();
  const forceCanvasResyncMutation = useForceCanvasResync();
  const cleanExpiredSharesMutation = useCleanExpiredShares();
  const cleanOldChatsMutation = useCleanOldChats();
  const reencryptMutation = useReencryptTokens();

  const { data: encryptionStatus } = useEncryptionStatus();
  const {
    data: dbHealth,
    refetch: refetchDbHealth,
    isFetching: dbHealthFetching,
  } = useDatabaseHealth();
  const { data: maintenanceStatus } = useMaintenanceStatus();

  const [chatDager, setChatDager] = useState(180);
  const [sisteResultat, setSisteResultat] = useState<{
    tittel: string;
    stats: StatKortData[];
  } | null>(null);

  // Global running-status: en operasjon vises som aktiv hvis enten denne brukeren
  // kjører den (isPending) ELLER en annen admin kjører den (via Redis-polling).
  const isRunning = (op: string, localPending: boolean) =>
    localPending || (maintenanceStatus?.ops[op]?.running ?? false);

  function kjorMedBekreftelse(melding: string, handlingstekst: string, muteringFn: () => void) {
    visBekreftelsesToast({ t, melding, handlingstekst, onBekreft: muteringFn });
  }

  const handleBackfill = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.backfill.confirm"),
      t("admin.maintenance.backfill.action"),
      () => {
        backfillMutation.mutate(undefined, {
          onSuccess: (r) => {
            setSisteResultat({
              tittel: t("admin.maintenance.backfill.cardTitle"),
              stats: [
                {
                  label: t("admin.maintenance.backfill.scannedFiles"),
                  verdi: r.scannedFiles,
                  ikon: FileText,
                },
                {
                  label: t("admin.maintenance.backfill.updatedFiles"),
                  verdi: r.updatedFiles,
                  ikon: CheckCircle2,
                },
              ],
            });
            showToast.success(t("admin.maintenance.backfill.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.backfill.failed"),
              hentFeilmelding(e, t("admin.maintenance.backfill.failed")),
            ),
        });
      },
    );

  const handleCleanupOrphaned = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.cleanupOrphaned.confirm"),
      t("admin.maintenance.cleanupOrphaned.action"),
      () => {
        cleanupOrphanedMutation.mutate(undefined, {
          onSuccess: (r) => {
            const d = r.deleted;
            const labels =
              language === "nb"
                ? {
                    chats: "Samtaler",
                    tasks: "Oppgaver",
                    docs: "Dokumenter",
                    plans: "Arbeidsplaner",
                    canvas: "Canvas-strukturer",
                    canvasUsers: "Canvas-brukere",
                    shares: "Delelinker",
                    kb: "Kunnskapsbaser",
                    kbChunks: "KB-chunks",
                  }
                : {
                    chats: "Chats",
                    tasks: "Tasks",
                    docs: "Documents",
                    plans: "Work plans",
                    canvas: "Canvas structures",
                    canvasUsers: "Canvas users",
                    shares: "Share links",
                    kb: "Knowledge bases",
                    kbChunks: "KB chunks",
                  };
            const stats: StatKortData[] = [];
            if (d.samtaler > 0)
              stats.push({ label: labels.chats, verdi: d.samtaler, ikon: Trash2 });
            if (d.oppgaveoppdelinger > 0)
              stats.push({ label: labels.tasks, verdi: d.oppgaveoppdelinger, ikon: Trash2 });
            if (d.dokumentfragmenter > 0)
              stats.push({ label: labels.docs, verdi: d.dokumentfragmenter, ikon: Database });
            if (d.arbeidsplaner > 0)
              stats.push({ label: labels.plans, verdi: d.arbeidsplaner, ikon: Trash2 });
            if (d.canvasStrukturer > 0)
              stats.push({ label: labels.canvas, verdi: d.canvasStrukturer, ikon: Trash2 });
            if (d.canvasBrukere > 0)
              stats.push({ label: labels.canvasUsers, verdi: d.canvasBrukere, ikon: Trash2 });
            if (d.delingslenker > 0)
              stats.push({ label: labels.shares, verdi: d.delingslenker, ikon: Link });
            if (d.kunnskapsbaser > 0)
              stats.push({ label: labels.kb, verdi: d.kunnskapsbaser, ikon: Database });
            if (d.kbChunks > 0)
              stats.push({ label: labels.kbChunks, verdi: d.kbChunks, ikon: Database });
            const total = Object.values(d).reduce((s, v) => s + v, 0);
            if (stats.length === 0)
              stats.push({
                label: t("admin.maintenance.cleanupOrphaned.action"),
                verdi: total,
                ikon: CheckCircle2,
              });
            setSisteResultat({
              tittel: t("admin.maintenance.cleanupOrphaned.cardTitle"),
              stats,
            });
            showToast.success(t("admin.maintenance.cleanupOrphaned.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.cleanupOrphaned.failed"),
              hentFeilmelding(e, t("admin.maintenance.cleanupOrphaned.failed")),
            ),
        });
      },
    );

  const handleRebuildEmbeddings = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.rebuildEmbeddings.confirm"),
      t("admin.maintenance.rebuildEmbeddings.action"),
      () => {
        rebuildEmbeddingsMutation.mutate(undefined, {
          onSuccess: (r) => {
            const embStats: StatKortData[] = [
              {
                label: t("admin.maintenance.rebuildEmbeddings.scannedChunks"),
                verdi: r.scannedChunks,
                ikon: Database,
              },
              {
                label: t("admin.maintenance.rebuildEmbeddings.reembeddedChunks"),
                verdi: r.reembeddedChunks,
                ikon: CheckCircle2,
              },
            ];
            if (r.failedChunks > 0)
              embStats.push({
                label: t("admin.maintenance.rebuildEmbeddings.failedChunks"),
                verdi: r.failedChunks,
                ikon: AlertTriangle,
              });
            setSisteResultat({
              tittel: t("admin.maintenance.rebuildEmbeddings.cardTitle"),
              stats: embStats,
            });
            showToast.success(t("admin.maintenance.rebuildEmbeddings.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.rebuildEmbeddings.failed"),
              hentFeilmelding(e, t("admin.maintenance.rebuildEmbeddings.failed")),
            ),
        });
      },
    );

  const handleForceCanvasResync = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.forceCanvasResync.confirm"),
      t("admin.maintenance.forceCanvasResync.action"),
      () => {
        forceCanvasResyncMutation.mutate(undefined, {
          onSuccess: (r) => {
            setSisteResultat({
              tittel: t("admin.maintenance.forceCanvasResync.cardTitle"),
              stats: [
                {
                  label: t("admin.maintenance.forceCanvasResync.usersInvalidated"),
                  verdi: r.usersInvalidated,
                  ikon: Users,
                },
                {
                  label: t("admin.maintenance.forceCanvasResync.keysDeleted"),
                  verdi: r.keysDeleted,
                  ikon: Database,
                },
              ],
            });
            showToast.success(t("admin.maintenance.forceCanvasResync.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.forceCanvasResync.failed"),
              hentFeilmelding(e, t("admin.maintenance.forceCanvasResync.failed")),
            ),
        });
      },
    );

  const handleCleanExpiredShares = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.cleanExpiredShares.confirm"),
      t("admin.maintenance.cleanExpiredShares.action"),
      () => {
        cleanExpiredSharesMutation.mutate(undefined, {
          onSuccess: (r) => {
            setSisteResultat({
              tittel: t("admin.maintenance.cleanExpiredShares.cardTitle"),
              stats: [
                {
                  label: t("admin.maintenance.cleanExpiredShares.deletedCount"),
                  verdi: r.deletedCount,
                  ikon: Link,
                },
              ],
            });
            showToast.success(t("admin.maintenance.cleanExpiredShares.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.cleanExpiredShares.failed"),
              hentFeilmelding(e, t("admin.maintenance.cleanExpiredShares.failed")),
            ),
        });
      },
    );

  const handleCleanOldChats = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.cleanOldChats.confirm"),
      t("admin.maintenance.cleanOldChats.action"),
      () => {
        cleanOldChatsMutation.mutate(chatDager, {
          onSuccess: (r) => {
            const chatStats: StatKortData[] = [
              {
                label: t("admin.maintenance.cleanOldChats.deletedChats"),
                verdi: r.deletedChats,
                ikon: Trash2,
              },
            ];
            if (r.deletedShares > 0)
              chatStats.push({
                label: t("admin.maintenance.cleanOldChats.deletedShares"),
                verdi: r.deletedShares,
                ikon: Link,
              });
            setSisteResultat({
              tittel: t("admin.maintenance.cleanOldChats.cardTitle"),
              stats: chatStats,
            });
            showToast.success(t("admin.maintenance.cleanOldChats.success"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.cleanOldChats.failed"),
              hentFeilmelding(e, t("admin.maintenance.cleanOldChats.failed")),
            ),
        });
      },
    );

  const handleReencrypt = () =>
    kjorMedBekreftelse(
      t("admin.maintenance.encryption.reencryptConfirm"),
      t("admin.maintenance.encryption.reencryptAction"),
      () => {
        reencryptMutation.mutate(undefined, {
          onSuccess: (r) => {
            const encStats: StatKortData[] = [
              {
                label: t("admin.maintenance.encryption.processed"),
                verdi: r.processed,
                ikon: Shield,
              },
            ];
            if (r.reencrypted > 0)
              encStats.push({
                label: t("admin.maintenance.encryption.reencrypted"),
                verdi: r.reencrypted,
                ikon: CheckCircle2,
              });
            if (r.alreadyCurrent > 0)
              encStats.push({
                label: t("admin.maintenance.encryption.alreadyCurrent"),
                verdi: r.alreadyCurrent,
                ikon: ShieldCheck,
              });
            if (r.failed > 0)
              encStats.push({
                label: t("admin.maintenance.encryption.failed"),
                verdi: r.failed,
                ikon: AlertTriangle,
              });
            setSisteResultat({ tittel: t("admin.maintenance.encryption.title"), stats: encStats });
            showToast.success(t("admin.maintenance.encryption.reencryptSuccess"));
          },
          onError: (e) =>
            showToast.error(
              t("admin.maintenance.encryption.reencryptFailed"),
              hentFeilmelding(e, t("admin.maintenance.encryption.reencryptFailed")),
            ),
        });
      },
    );

  const SUB_FANER = [
    { id: "ops" as const, labelKey: "admin.maintenance.subtabs.ops" as const },
    { id: "crawler" as const, labelKey: "admin.maintenance.subtabs.crawler" as const },
    { id: "retrieval" as const, labelKey: "admin.maintenance.subtabs.retrieval" as const },
    { id: "extraction" as const, labelKey: "admin.maintenance.subtabs.extraction" as const },
    { id: "kbHealth" as const, labelKey: "admin.maintenance.subtabs.kbHealth" as const },
  ];
  type MaintenanceSubFane = (typeof SUB_FANER)[number]["id"];
  const [aktivSub, setAktivSub] = useState<MaintenanceSubFane>("ops");

  return (
    <section className="space-y-6">
      {/* Overskrift */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.maintenance.title")}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t("admin.maintenance.description")}
        </p>
      </div>

      {/* Sub-fane-navigasjon */}
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800 p-1"
      >
        {SUB_FANER.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktivSub === id}
            onClick={() => setAktivSub(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
              aktivSub === id
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {aktivSub === "crawler" && <CrawlerFane />}
      {aktivSub === "retrieval" && <RetrievalDebugFane />}
      {aktivSub === "extraction" && <ExtractionAuditFane />}
      {aktivSub === "kbHealth" && <KbHealthFane />}

      {aktivSub === "ops" && (
        <>
      {/* Operasjons-kort */}
      <div className="grid gap-4 md:grid-cols-2">
        <VedlikeholdKort
          ikon={Zap}
          tittel={t("admin.maintenance.backfill.cardTitle")}
          beskrivelse={t("admin.maintenance.backfill.cardDescription")}
          merknad={t("admin.maintenance.backfill.note")}
          handlingTekst={t("admin.maintenance.backfill.action")}
          onHandling={handleBackfill}
          isPending={isRunning("backfill-fulltext", backfillMutation.isPending)}
        />
        <VedlikeholdKort
          ikon={Trash2}
          tittel={t("admin.maintenance.cleanupOrphaned.cardTitle")}
          beskrivelse={t("admin.maintenance.cleanupOrphaned.cardDescription")}
          merknad={t("admin.maintenance.cleanupOrphaned.note")}
          handlingTekst={t("admin.maintenance.cleanupOrphaned.action")}
          onHandling={handleCleanupOrphaned}
          isPending={isRunning("cleanup-orphaned", cleanupOrphanedMutation.isPending)}
          variant="danger"
        />
        <VedlikeholdKort
          ikon={Database}
          tittel={t("admin.maintenance.rebuildEmbeddings.cardTitle")}
          beskrivelse={t("admin.maintenance.rebuildEmbeddings.cardDescription")}
          merknad={t("admin.maintenance.rebuildEmbeddings.note")}
          handlingTekst={t("admin.maintenance.rebuildEmbeddings.action")}
          onHandling={handleRebuildEmbeddings}
          isPending={isRunning("rebuild-embeddings", rebuildEmbeddingsMutation.isPending)}
        />
        <VedlikeholdKort
          ikon={RefreshCcw}
          tittel={t("admin.maintenance.forceCanvasResync.cardTitle")}
          beskrivelse={t("admin.maintenance.forceCanvasResync.cardDescription")}
          merknad={t("admin.maintenance.forceCanvasResync.note")}
          handlingTekst={t("admin.maintenance.forceCanvasResync.action")}
          onHandling={handleForceCanvasResync}
          isPending={isRunning("force-canvas-resync", forceCanvasResyncMutation.isPending)}
        />
        <VedlikeholdKort
          ikon={Link}
          tittel={t("admin.maintenance.cleanExpiredShares.cardTitle")}
          beskrivelse={t("admin.maintenance.cleanExpiredShares.cardDescription")}
          merknad={t("admin.maintenance.cleanExpiredShares.note")}
          handlingTekst={t("admin.maintenance.cleanExpiredShares.action")}
          onHandling={handleCleanExpiredShares}
          isPending={isRunning("clean-expired-shares", cleanExpiredSharesMutation.isPending)}
        />
        <VedlikeholdKort
          ikon={Clock3}
          tittel={t("admin.maintenance.cleanOldChats.cardTitle")}
          beskrivelse={t("admin.maintenance.cleanOldChats.cardDescription")}
          merknad={t("admin.maintenance.cleanOldChats.note")}
          handlingTekst={t("admin.maintenance.cleanOldChats.action")}
          onHandling={handleCleanOldChats}
          isPending={isRunning("clean-old-chats", cleanOldChatsMutation.isPending)}
          variant="danger"
        >
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("admin.maintenance.cleanOldChats.daysLabel")}:
            </label>
            <input
              type="number"
              min={30}
              max={3650}
              value={chatDager}
              onChange={(e) =>
                setChatDager(Math.max(30, Math.min(3650, Number(e.target.value) || 30)))
              }
              className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
          </div>
        </VedlikeholdKort>
      </div>

      {/* Krypteringsstatus */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <Shield size={16} />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t("admin.maintenance.encryption.title")}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t("admin.maintenance.encryption.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReencrypt}
            disabled={isRunning("reencrypt-tokens", reencryptMutation.isPending)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            <RefreshCcw
              size={12}
              className={
                isRunning("reencrypt-tokens", reencryptMutation.isPending) ? "animate-spin" : ""
              }
            />
            {t("admin.maintenance.encryption.reencryptAction")}
          </button>
        </div>
        {encryptionStatus && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.maintenance.encryption.previousKeyConfigured")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {encryptionStatus.previousKeyConfigured
                  ? t("admin.maintenance.encryption.yes")
                  : t("admin.maintenance.encryption.no")}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.maintenance.encryption.usersWithToken")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                {formaterTall(encryptionStatus.usersWithToken, language)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.maintenance.encryption.currentFormat")}
              </p>
              <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {formaterTall(encryptionStatus.currentKeyOk, language)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.maintenance.encryption.legacyFormat")}
              </p>
              <p className="mt-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                {formaterTall(encryptionStatus.legacyFormat, language)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.maintenance.encryption.undecryptable")}
              </p>
              <p className="mt-1 text-sm font-semibold text-red-600 dark:text-red-400">
                {formaterTall(encryptionStatus.undecryptable, language)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Databasehelse */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <Server size={16} />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t("admin.maintenance.database.title")}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t("admin.maintenance.database.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetchDbHealth()}
            disabled={dbHealthFetching}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            <RefreshCcw size={12} className={dbHealthFetching ? "animate-spin" : ""} />
            {t("admin.maintenance.database.refresh")}
          </button>
        </div>
        {dbHealth && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.maintenance.database.totalCollections")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {formaterTall(dbHealth.collections.length, language)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.maintenance.database.totalDocuments")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {formaterTall(dbHealth.totalDocuments, language)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.maintenance.database.totalSize")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {formaterBytes(dbHealth.totalSizeBytes)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.maintenance.database.totalIndexSize")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {formaterBytes(dbHealth.totalIndexSizeBytes)}
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                      {t("admin.maintenance.database.collectionName")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                      {t("admin.maintenance.database.documents")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                      {t("admin.maintenance.database.size")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                      {t("admin.maintenance.database.indexes")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                      {t("admin.maintenance.database.indexSize")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dbHealth.collections.map((coll) => (
                    <tr
                      key={coll.name}
                      className="border-b border-slate-100 dark:border-slate-700/50"
                    >
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                        {coll.name}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                        {formaterTall(coll.documentCount, language)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                        {formaterBytes(coll.sizeBytes)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                        {coll.indexCount}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                        {formaterBytes(coll.indexSizeBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Siste resultat */}
      {sisteResultat && (
        <StatSeksjon
          title={`${t("admin.maintenance.lastResult")} — ${sisteResultat.tittel}`}
          language={language}
          stats={sisteResultat.stats}
        />
      )}
        </>
      )}
    </section>
  );
}

// ── Service Status Panel ─────────────────────────────────────────────────────

type ServiceKey = "mongo" | "redis" | "bullmq" | "anthropic" | "cohere" | "clerk" | "pinecone";

function statusClasses(status: "up" | "down" | "unknown"): string {
  if (status === "up") return "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]";
  if (status === "down") return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]";
  return "bg-slate-400";
}

function ServiceStatusPanel() {
  const { t } = useLanguage();
  const { data, isLoading, error } = useDependenciesHealth();

  const services: ServiceKey[] = [
    "mongo",
    "redis",
    "bullmq",
    "anthropic",
    "cohere",
    "clerk",
    "pinecone",
  ];

  // Oppsummering: hvis en kritisk tjeneste er nede = "down", hvis en valgfri er nede = "degraded", ellers "allOk".
  const overallStatus = (() => {
    if (!data) return "unknown" as const;
    const deps = data.dependencies;
    const criticalDown = services.some(
      (s) => deps[s].critical && deps[s].status === "down",
    );
    if (criticalDown) return "down" as const;
    const anyDown = services.some((s) => deps[s].status === "down");
    if (anyDown) return "degraded" as const;
    const anyUnknown = services.some((s) => deps[s].status === "unknown");
    if (anyUnknown) return "unknown" as const;
    return "allOk" as const;
  })();

  const overallLabel =
    overallStatus === "allOk"
      ? t("admin.serviceStatus.allOk")
      : overallStatus === "down"
        ? t("admin.serviceStatus.down")
        : overallStatus === "degraded"
          ? t("admin.serviceStatus.degraded")
          : t("admin.serviceStatus.loading");

  const overallBadgeClass =
    overallStatus === "allOk"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      : overallStatus === "down"
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        : overallStatus === "degraded"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Activity className="h-4 w-4" />
            {t("admin.serviceStatus.title")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.serviceStatus.description")}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${overallBadgeClass}`}
        >
          {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          {overallLabel}
        </span>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          {t("admin.serviceStatus.loadError")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => {
          const dep = data?.dependencies[service];
          const status = dep?.status ?? "unknown";
          const critical = dep?.critical ?? false;
          return (
            <div
              key={service}
              className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${statusClasses(status)}`} />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {t(`admin.serviceStatus.services.${service}` as never)}
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {critical
                  ? t("admin.serviceStatus.criticalLabel")
                  : t("admin.serviceStatus.optionalLabel")}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Global Announcement Panel ────────────────────────────────────────────────

function AnnouncementPanel() {
  const { t } = useLanguage();
  const { data: current } = useAdminAnnouncement();
  const publish = usePublishAnnouncement();
  const clear = useClearAnnouncement();

  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [melding, setMelding] = useState("");
  const [dismissible, setDismissible] = useState(true);
  const [showInBanner, setShowInBanner] = useState(true);
  const [showOnStatusPage, setShowOnStatusPage] = useState(true);
  // Prefill-strategi:
  // - Første gang `current` er aktiv, fyll form og lagre `oppdatertAt` vi synket mot.
  // - Hvis form's verdier matcher siste synkede verdi (bruker har ikke redigert),
  //   og `current.oppdatertAt` endres (annen admin publiserte), auto-oppdater.
  // - Hvis form avviker (bruker redigerer), vis notice så de kan velge selv.
  type Snapshot = {
    oppdatertAt: string;
    severity: "info" | "warning" | "critical";
    melding: string;
    dismissible: boolean;
    showInBanner: boolean;
    showOnStatusPage: boolean;
  };
  const syncedSnapshotRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    if (!current?.active) return;
    const snap = syncedSnapshotRef.current;
    const apply = (next: Snapshot) => {
      setSeverity(next.severity);
      setMelding(next.melding);
      setDismissible(next.dismissible);
      setShowInBanner(next.showInBanner);
      setShowOnStatusPage(next.showOnStatusPage);
      syncedSnapshotRef.current = next;
    };
    const nextSnap: Snapshot = {
      oppdatertAt: current.oppdatertAt,
      severity: current.severity,
      melding: current.melding,
      dismissible: current.dismissible,
      showInBanner: current.showInBanner,
      showOnStatusPage: current.showOnStatusPage,
    };
    if (!snap) {
      // Første prefill
      apply(nextSnap);
      return;
    }
    if (snap.oppdatertAt === current.oppdatertAt) return;
    // Bakenden har en nyere versjon. Hvis bruker ikke har redigert siden sist
    // sync, apply automatisk. Ellers vises notice via `harEksternEndring` under.
    const uendret =
      severity === snap.severity &&
      melding === snap.melding &&
      dismissible === snap.dismissible &&
      showInBanner === snap.showInBanner &&
      showOnStatusPage === snap.showOnStatusPage;
    if (uendret) {
      apply(nextSnap);
    }
  }, [current, severity, melding, dismissible, showInBanner, showOnStatusPage]);

  const harEksternEndring =
    current?.active === true &&
    syncedSnapshotRef.current !== null &&
    syncedSnapshotRef.current.oppdatertAt !== current.oppdatertAt;

  const trimmed = melding.trim();
  // Minst ett visningsmål må være valgt — ellers er meldingen meningsløs.
  const harVisningsmaal = showInBanner || showOnStatusPage;
  const canSubmit =
    trimmed.length > 0 &&
    trimmed.length <= 500 &&
    harVisningsmaal &&
    !publish.isPending;

  const handlePublish = () => {
    publish.mutate(
      { severity, melding: trimmed, dismissible, showInBanner, showOnStatusPage },
      {
        onSuccess: (result) => {
          showToast.success(t("admin.announcement.published"));
          // Backend rapporterer cacheInvalidated=false når Redis-invalidering
          // feilet. Andre dyner kan da vise foreldet banner/status inntil
          // cache-TTL (typisk 30s) løper ut — advar admin så de vet hvorfor
          // publiseringen ikke er synlig umiddelbart andre steder.
          if (result.cacheInvalidated === false) {
            showToast.warning(
              t("admin.announcement.cacheInvalidationFailedTitle"),
              t("admin.announcement.cacheInvalidationFailedDescription"),
            );
          }
        },
        onError: () => showToast.error(t("admin.announcement.publishError")),
      },
    );
  };

  const handleClear = () => {
    clear.mutate(undefined, {
      onSuccess: (result) => {
        showToast.success(t("admin.announcement.cleared"));
        setMelding("");
        syncedSnapshotRef.current = null;
        if (result.cacheInvalidated === false) {
          showToast.warning(
            t("admin.announcement.cacheInvalidationFailedTitle"),
            t("admin.announcement.cacheInvalidationFailedDescription"),
          );
        }
      },
      onError: () => showToast.error(t("admin.announcement.clearError")),
    });
  };

  const handleReload = () => {
    if (!current?.active) return;
    setSeverity(current.severity);
    setMelding(current.melding);
    setDismissible(current.dismissible);
    setShowInBanner(current.showInBanner);
    setShowOnStatusPage(current.showOnStatusPage);
    syncedSnapshotRef.current = {
      oppdatertAt: current.oppdatertAt,
      severity: current.severity,
      melding: current.melding,
      dismissible: current.dismissible,
      showInBanner: current.showInBanner,
      showOnStatusPage: current.showOnStatusPage,
    };
  };

  const severityOption = (
    value: "info" | "warning" | "critical",
    label: string,
    activeClass: string,
  ) => (
    <button
      key={value}
      type="button"
      onClick={() => setSeverity(value)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        severity === value
          ? activeClass
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Megaphone className="h-4 w-4" />
            {t("admin.announcement.title")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.announcement.description")}
          </p>
        </div>
        {current?.active ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t("admin.announcement.currentTitle")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {t("admin.announcement.noneActive")}
          </span>
        )}
      </div>

      {harEksternEndring && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{t("admin.announcement.externalChange")}</span>
          <button
            type="button"
            onClick={handleReload}
            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            {t("admin.announcement.reload")}
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
            {t("admin.announcement.severityLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            {severityOption(
              "info",
              t("admin.announcement.severityInfo"),
              "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
            )}
            {severityOption(
              "warning",
              t("admin.announcement.severityWarning"),
              "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
            )}
            {severityOption(
              "critical",
              t("admin.announcement.severityCritical"),
              "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="admin-announcement-melding"
            className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            {t("admin.announcement.meldingLabel")}
          </label>
          <textarea
            id="admin-announcement-melding"
            value={melding}
            onChange={(e) => setMelding(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
            placeholder={t("admin.announcement.meldingPlaceholder")}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {t("admin.announcement.meldingHint")} ({trimmed.length}/500)
          </p>
          <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
            {t("admin.announcement.publicWarning")}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={dismissible}
            onChange={(e) => setDismissible(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
          />
          {t("admin.announcement.dismissibleLabel")}
        </label>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-slate-700 dark:text-slate-300">
            {t("admin.announcement.targetsLabel")}
          </legend>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showInBanner}
              onChange={(e) => setShowInBanner(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            {t("admin.announcement.showInBannerLabel")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showOnStatusPage}
              onChange={(e) => setShowOnStatusPage(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
            />
            {t("admin.announcement.showOnStatusPageLabel")}
          </label>
          {!harVisningsmaal && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("admin.announcement.targetsRequired")}
            </p>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handlePublish}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {publish.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {publish.isPending
              ? t("admin.announcement.publishing")
              : current?.active
                ? t("admin.announcement.update")
                : t("admin.announcement.publish")}
          </button>
          {current?.active && (
            <button
              type="button"
              onClick={handleClear}
              disabled={clear.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {clear.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {clear.isPending ? t("admin.announcement.clearing") : t("admin.announcement.clear")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatistikkFane() {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminStats();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.errors.statsFailed")} />;

  const brukerStats: StatKortData[] = [
    { label: t("admin.stats.totalUsers"), verdi: data.brukere.totalt, ikon: Users },
    { label: t("admin.stats.adminUsers"), verdi: data.brukere.admin, ikon: ShieldCheck },
    { label: t("admin.stats.regularUsers"), verdi: data.brukere.vanlige, ikon: Users },
    { label: t("admin.stats.canvasUsers"), verdi: data.brukere.medCanvas, ikon: Link },
    { label: t("admin.stats.withoutCanvasUsers"), verdi: data.brukere.utenCanvas, ikon: UserX },
    { label: t("admin.stats.deletedUsers"), verdi: data.brukere.slettede, ikon: Trash2 },
    { label: t("admin.stats.googleUsers"), verdi: data.brukere.google, ikon: Users },
    { label: t("admin.stats.microsoftUsers"), verdi: data.brukere.microsoft, ikon: Building2 },
    { label: t("admin.stats.emailUsers"), verdi: data.brukere.email, ikon: Mail },
    {
      label: t("admin.stats.unknownProviderUsers"),
      verdi: data.brukere.ukjentProvider,
      ikon: AlertTriangle,
    },
  ];

  const samtaleStats: StatKortData[] = [
    { label: t("admin.stats.totalChats"), verdi: data.samtaler.totalt, ikon: ScrollText },
    { label: t("admin.stats.bookmarkedChats"), verdi: data.samtaler.bokmerket, ikon: Pin },
    {
      label: t("admin.stats.avgChatsPerUser"),
      verdi: data.samtaler.snittPerBruker,
      ikon: BarChart3,
    },
    { label: t("admin.stats.activeShareLinks"), verdi: data.deling.aktiveLenker, ikon: Share2 },
    { label: t("admin.stats.inactiveShareLinks"), verdi: data.deling.inaktiveLenker, ikon: Share2 },
    { label: t("admin.stats.expiredShareLinks"), verdi: data.deling.utlopteLenker, ikon: Clock3 },
    {
      label: t("admin.stats.shareLinksWithViews"),
      verdi: data.deling.lenkerMedVisninger,
      ikon: Eye,
    },
    { label: t("admin.stats.shareViewsTotal"), verdi: data.deling.visningerTotalt, ikon: Eye },
  ];

  const planStats: StatKortData[] = [
    {
      label: t("admin.stats.totalTasks"),
      verdi: data.oppgaver.oppgaveoppdelinger,
      ikon: BarChart3,
    },
    {
      label: t("admin.stats.totalSubtasks"),
      verdi: data.oppgaver.deloppgaverTotalt,
      ikon: BarChart3,
    },
    {
      label: t("admin.stats.completedSubtasks"),
      verdi: data.oppgaver.fullforteDeloppgaver,
      ikon: CheckCircle2,
    },
    {
      label: t("admin.stats.approvedSubtasks"),
      verdi: data.oppgaver.godkjenteDeloppgaver,
      ikon: CheckCircle2,
    },
    {
      label: t("admin.stats.avgSubtasksPerBreakdown"),
      verdi: data.oppgaver.snittDeloppgaverPerOppdeling,
      ikon: BarChart3,
    },
    { label: t("admin.stats.workPlans"), verdi: data.arbeidsplan.planer, ikon: CalendarDays },
    {
      label: t("admin.stats.workPlanBlocks"),
      verdi: data.arbeidsplan.blokkerTotalt,
      ikon: CalendarDays,
    },
    {
      label: t("admin.stats.completedWorkPlanBlocks"),
      verdi: data.arbeidsplan.fullforteBlokker,
      ikon: CheckCircle2,
    },
    {
      label: t("admin.stats.usersWithWorkPlan"),
      verdi: data.arbeidsplan.brukereMedPlan,
      ikon: Users,
    },
    {
      label: t("admin.stats.workPlanCompletionRate"),
      verdi: data.arbeidsplan.fullforingsgrad,
      ikon: BarChart3,
      format: "percent",
    },
  ];

  const innholdsStats: StatKortData[] = [
    {
      label: t("admin.stats.totalEmbeddings"),
      verdi: data.innhold.dokumentfragmenter,
      ikon: Database,
    },
    { label: t("admin.stats.documentFiles"), verdi: data.innhold.dokumentfiler, ikon: FileText },
    { label: t("admin.stats.documentCourses"), verdi: data.innhold.dokumentemner, ikon: BookOpen },
    {
      label: t("admin.stats.usersWithContent"),
      verdi: data.innhold.brukereMedInnhold,
      ikon: Users,
    },
    { label: t("admin.stats.totalTokens"), verdi: data.innhold.tokensTotalt, ikon: Database },
    {
      label: t("admin.stats.avgChunksPerFile"),
      verdi: data.innhold.snittChunksPerFil,
      ikon: BarChart3,
    },
    {
      label: t("admin.stats.cachedCourseStructures"),
      verdi: data.innhold.kursstrukturer,
      ikon: BookOpen,
    },
    {
      label: t("admin.stats.cachedCanvasAssignments"),
      verdi: data.innhold.canvasOppgaver,
      ikon: ScrollText,
    },
    {
      label: t("admin.stats.cachedCanvasAnnouncements"),
      verdi: data.innhold.canvasKunngjoringer,
      ikon: ScrollText,
    },
    {
      label: t("admin.stats.cachedCanvasModules"),
      verdi: data.innhold.canvasModuler,
      ikon: BookOpen,
    },
    {
      label: t("admin.stats.cachedCanvasModuleItems"),
      verdi: data.innhold.canvasModulElementer,
      ikon: FileText,
    },
  ];

  const syncStats: StatKortData[] = [
    {
      label: t("admin.stats.usersWithSyncData"),
      verdi: data.sync.brukereMedSyncData,
      ikon: RefreshCcw,
    },
    {
      label: t("admin.stats.usersWithFreshSync24h"),
      verdi: data.sync.brukereMedFerskSync24t,
      ikon: RefreshCcw,
    },
    {
      label: t("admin.stats.usersWithStaleSync7d"),
      verdi: data.sync.brukereMedGammelSync7d,
      ikon: Clock3,
    },
    {
      label: t("admin.stats.canvasUsersWithoutSync"),
      verdi: data.sync.canvasBrukereUtenSyncData,
      ikon: AlertTriangle,
    },
  ];

  const varslerStats: StatKortData[] = [
    { label: t("admin.stats.pushSubscriptions"), verdi: data.varsler.pushAbonnementer, ikon: Bell },
    { label: t("admin.stats.usersWithPush"), verdi: data.varsler.brukereMedPush, ikon: Users },
    {
      label: t("admin.stats.avgDevicesPerUser"),
      verdi: data.varsler.snittEnheterPerBruker,
      ikon: BarChart3,
    },
    {
      label: t("admin.stats.usersWithNotion"),
      verdi: data.integrasjoner.brukereMedNotion,
      ikon: FileUp,
    },
  ];

  const revisjonsStats: StatKortData[] = [
    {
      label: t("admin.stats.auditEventsTotal"),
      verdi: data.revisjon.hendelserTotalt,
      ikon: Activity,
    },
    {
      label: t("admin.stats.auditFailuresTotal"),
      verdi: data.revisjon.feilTotalt,
      ikon: AlertTriangle,
    },
    { label: t("admin.stats.auditEvents24h"), verdi: data.revisjon.hendelser24t, ikon: Activity },
    { label: t("admin.stats.auditFailures24h"), verdi: data.revisjon.feil24t, ikon: AlertTriangle },
    { label: t("admin.stats.adminEvents24h"), verdi: data.revisjon.admin24t, ikon: Shield },
    { label: t("admin.stats.authEvents24h"), verdi: data.revisjon.auth24t, ikon: Shield },
    {
      label: t("admin.stats.integrationEvents24h"),
      verdi: data.revisjon.integration24t,
      ikon: Link,
    },
    { label: t("admin.stats.aiEvents24h"), verdi: data.revisjon.ki24t, ikon: BarChart3 },
    { label: t("admin.stats.privacyEvents24h"), verdi: data.revisjon.privacy24t, ikon: Shield },
    { label: t("admin.stats.profileEvents24h"), verdi: data.revisjon.profile24t, ikon: Users },
    {
      label: t("admin.stats.securityEvents24h"),
      verdi: data.revisjon.security24t,
      ikon: ShieldCheck,
    },
  ];

  const kunnskapsbaseStats: StatKortData[] = [
    { label: t("admin.stats.kbBases"), verdi: data.kunnskapsbase.baser, ikon: Library },
    {
      label: t("admin.stats.kbUsersWithBase"),
      verdi: data.kunnskapsbase.brukereMedBase,
      ikon: Users,
    },
    {
      label: t("admin.stats.kbAvgBasesPerUser"),
      verdi: data.kunnskapsbase.snittBaserPerBruker,
      ikon: BarChart3,
    },
    { label: t("admin.stats.kbLinks"), verdi: data.kunnskapsbase.lenker, ikon: Link2 },
    { label: t("admin.stats.kbFiles"), verdi: data.kunnskapsbase.filer, ikon: FileText },
    { label: t("admin.stats.kbChunks"), verdi: data.kunnskapsbase.chunks, ikon: Database },
    { label: t("admin.stats.kbCrawled"), verdi: data.kunnskapsbase.crawledeLenker, ikon: Link2 },
    {
      label: t("admin.stats.kbCrawlFailed"),
      verdi: data.kunnskapsbase.feiledeLenker,
      ikon: AlertTriangle,
    },
  ];

  const kvalitetsStats: StatKortData[] = [
    {
      label: t("admin.stats.orphanedChats"),
      verdi: data.kvalitet.orphanedSamtaler,
      ikon: AlertTriangle,
    },
    {
      label: t("admin.stats.orphanedTaskBreakdowns"),
      verdi: data.kvalitet.orphanedOppgaveoppdelinger,
      ikon: AlertTriangle,
    },
    {
      label: t("admin.stats.orphanedDocumentChunks"),
      verdi: data.kvalitet.orphanedDokumentfragmenter,
      ikon: Database,
    },
    {
      label: t("admin.stats.orphanedWorkPlans"),
      verdi: data.kvalitet.orphanedArbeidsplaner,
      ikon: CalendarDays,
    },
    {
      label: t("admin.stats.orphanedCanvasStructures"),
      verdi: data.kvalitet.orphanedCanvasStrukturer,
      ikon: BookOpen,
    },
    {
      label: t("admin.stats.orphanedCanvasUsers"),
      verdi: data.kvalitet.orphanedCanvasBrukere,
      ikon: UserX,
    },
    {
      label: t("admin.stats.ownerlessShareLinks"),
      verdi: data.kvalitet.delingerUtenEier,
      ikon: Share2,
    },
    {
      label: t("admin.stats.orphanedKnowledgeBases"),
      verdi: data.kvalitet.orphanedKunnskapsbaser,
      ikon: Library,
    },
    {
      label: t("admin.stats.orphanedKBChunks"),
      verdi: data.kvalitet.orphanedKBChunks,
      ikon: Database,
    },
  ];

  return (
    <div className="space-y-8">
      <ServiceStatusPanel />
      <AnnouncementPanel />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("admin.stats.note")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://fb26zl.grafana.net/d/fbrdskw/studywize-observability?orgId=1&from=now-24h&to=now&timezone=browser"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Grafana
            <ExternalLink size={14} />
          </a>
          <a
            href="https://us5.datadoghq.com/help/quick_start?tab=infrastructure"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Datadog
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      <StatSeksjon
        title={t("admin.stats.sections.users")}
        stats={brukerStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.conversations")}
        stats={samtaleStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.planning")}
        stats={planStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.content")}
        stats={innholdsStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.knowledgeBase")}
        stats={kunnskapsbaseStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.notifications")}
        stats={varslerStats}
        language={language}
      />
      <StatSeksjon title={t("admin.stats.sections.sync")} stats={syncStats} language={language} />
      <StatSeksjon
        title={t("admin.stats.sections.audit")}
        stats={revisjonsStats}
        language={language}
      />
      <StatSeksjon
        title={t("admin.stats.sections.quality")}
        stats={kvalitetsStats}
        language={language}
      />
    </div>
  );
}

// ── Observability-fane ───────────────────────────────────────────────────────

function ObservabilityFane() {
  const { language, t } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<LangsmithStatusFilter>("all");
  const [intentFilter, setIntentFilter] = useState("");
  const [runPage, setRunPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const limit = 20;

  const dailyQuery = useDailyMetrics();
  const dailyLoading = dailyQuery.isLoading;
  const dailyError = !!dailyQuery.error;
  const dailyMetrics = dailyQuery.data ?? [];
  const sisteDognLatency = dailyMetrics.at(-1)?.avgLatencyMs ?? null;
  const hoyesteLatency =
    dailyMetrics.length > 0
      ? Math.max(...dailyMetrics.map((entry: { avgLatencyMs: number }) => entry.avgLatencyMs))
      : null;

  const overviewQuery = useLangsmithOverview();
  const overviewLoading = overviewQuery.isLoading;
  const overviewError = !!overviewQuery.error;
  const overviewData = overviewQuery.data;
  const observabilityStats: StatKortData[] = [
    {
      label: t("admin.stats.aiObservability.totalRuns24h"),
      verdi: overviewData?.totalRuns24h ?? 0,
      ikon: Activity,
    },
    {
      label: t("admin.stats.aiObservability.totalRuns7d"),
      verdi: overviewData?.totalRuns7d ?? 0,
      ikon: Activity,
    },
  ];

  const runsQuery = useRuns(runPage, statusFilter, intentFilter);
  const runsLoading = runsQuery.isLoading;
  const runsError = !!runsQuery.error;
  const runsData = runsQuery.data;
  const runsTotalPages = runsData ? Math.max(1, Math.ceil(runsData.total / limit)) : 1;

  const runDetailQuery = useRunDetail(selectedRunId ?? null);
  const runDetailLoading = runDetailQuery.isLoading;
  const runDetailError = !!runDetailQuery.error;
  const runDetail = runDetailQuery.data;

  const clearCacheMutation = useClearLangsmithCache();

  if (overviewLoading && !overviewData) {
    return <LoadingSpinner />;
  }

  if (overviewError && !overviewData) {
    return <FeilMelding melding={t("admin.stats.aiObservability.loadFailed")} />;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.stats.sections.observability")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => clearCacheMutation.mutate()}
            disabled={clearCacheMutation.isPending}
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={14} className={clearCacheMutation.isPending ? "animate-spin" : ""} />
            {t("admin.stats.aiObservability.clearCache")}
          </button>
          <a
            href="https://smith.langchain.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            LangSmith
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <div className="space-y-4">
        <StatSeksjon
          title={t("admin.stats.aiObservability.cardsTitle")}
          stats={observabilityStats}
          language={language}
        />

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("admin.stats.aiObservability.overviewLineRuns", {
            runs24h: formaterTall(overviewData?.totalRuns24h ?? 0, language),
            runs7d: formaterTall(overviewData?.totalRuns7d ?? 0, language),
          })}
        </p>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.latencySummaryTitle")}
          </p>
          {dailyLoading || overviewLoading ? (
            <LoadingSpinner />
          ) : dailyError || overviewError ? (
            <FeilMelding melding={t("admin.stats.aiObservability.loadFailed")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyAverageLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {formaterTall(overviewData?.avgLatencyMs ?? 0, language)} ms
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyLatestLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {sisteDognLatency != null
                    ? `${formaterTall(sisteDognLatency, language)} ms`
                    : "–"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.latencyPeakLabel")}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {hoyesteLatency != null ? `${formaterTall(hoyesteLatency, language)} ms` : "–"}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.tracingTableTitle")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => {
                const value = event.target.value as LangsmithStatusFilter;
                setStatusFilter(value);
                setRunPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base sm:text-sm text-slate-700 dark:text-slate-200"
            >
              <option value="all">{t("admin.stats.aiObservability.filters.statusAll")}</option>
              <option value="success">
                {t("admin.stats.aiObservability.filters.statusSuccess")}
              </option>
              <option value="error">{t("admin.stats.aiObservability.filters.statusError")}</option>
            </select>
            <input
              type="text"
              value={intentFilter}
              onChange={(event) => {
                setIntentFilter(event.target.value);
                setRunPage(1);
              }}
              placeholder={t("admin.stats.aiObservability.filters.intentPlaceholder")}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base sm:text-sm text-slate-700 dark:text-slate-200"
            />
          </div>

          {runsLoading ? (
            <LoadingSpinner />
          ) : runsError ? (
            <FeilMelding melding={t("admin.stats.aiObservability.runsLoadFailed")} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-160 text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        {t("admin.stats.aiObservability.table.timestamp")}
                      </th>
                      <th className="px-3 py-2 text-left">
                        {t("admin.stats.aiObservability.table.model")}
                      </th>
                      <th className="px-3 py-2 text-left">
                        {t("admin.stats.aiObservability.table.intent")}
                      </th>
                      <th className="px-3 py-2 text-right">
                        {t("admin.stats.aiObservability.table.tokens")}
                      </th>
                      <th className="px-3 py-2 text-right">
                        {t("admin.stats.aiObservability.table.latency")}
                      </th>
                      <th className="px-3 py-2 text-left">
                        {t("admin.stats.aiObservability.table.status")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {runsData && runsData.runs.length > 0 ? (
                      runsData.runs.map((run: LangsmithRunRow) => (
                        <tr
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className="cursor-pointer bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {formaterDatoOgTid(run.timestamp, language)}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {run.model}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {run.intent}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                            {formaterTall(run.totalTokens, language)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                            {formaterTall(run.latencyMs, language)} ms
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                run.status === "success"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          {t("admin.stats.aiObservability.table.noRuns")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {runsData && runsData.total > 0 && (
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {t("admin.stats.aiObservability.table.totalRuns", {
                      total: formaterTall(runsData.total, language),
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRunPage((prev) => Math.max(1, prev - 1))}
                      disabled={runPage <= 1}
                      className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 disabled:opacity-50"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>
                      {t("admin.stats.aiObservability.table.pageLabel", {
                        page: formaterTall(runPage, language),
                        totalPages: formaterTall(runsTotalPages, language),
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRunPage((prev) => Math.min(runsTotalPages, prev + 1))}
                      disabled={runPage >= runsTotalPages}
                      className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 disabled:opacity-50"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("admin.stats.aiObservability.detailsTitle")}
          </p>
          {!selectedRunId && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("admin.stats.aiObservability.detailsHint")}
            </p>
          )}
          {selectedRunId && runDetailLoading && <LoadingSpinner />}
          {selectedRunId && runDetailError && (
            <FeilMelding melding={t("admin.stats.aiObservability.runDetailLoadFailed")} />
          )}
          {selectedRunId && runDetail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">
                    {t("admin.stats.aiObservability.detail.input")}
                  </p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.inputTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">
                    {t("admin.stats.aiObservability.detail.output")}
                  </p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.outputTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">
                    {t("admin.stats.aiObservability.detail.total")}
                  </p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.totalTokens, language)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2">
                  <p className="text-slate-500 dark:text-slate-400">
                    {t("admin.stats.aiObservability.detail.latency")}
                  </p>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {formaterTall(runDetail.latencyMs, language)} ms
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.systemPrompt")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.systemPromptPreview || "—"}
                </pre>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.userPrompt")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.promptPreview || "—"}
                </pre>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("admin.stats.aiObservability.detail.outputPreview")}
                </p>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {runDetail.outputPreview || "—"}
                </pre>
              </div>
              {runDetail.errorMessage && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                  {runDetail.errorMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Brukerdetalj-modal (privacy-respekterende oversikt) ─────────────────────

function BrukerDetaljModal({
  brukerId,
  onClose,
  onResetMfa,
  isResettingMfa,
}: {
  brukerId: string;
  onClose: () => void;
  onResetMfa: (brukerId: string) => void;
  isResettingMfa: boolean;
}) {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminBrukerDetalj(brukerId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bruker-detalj-tittel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-dvh w-full max-w-3xl overflow-y-auto rounded-none border-0 bg-white p-4 shadow-2xl sm:max-h-[90vh] sm:rounded-xl sm:border sm:border-slate-200 sm:p-6 dark:bg-slate-800 sm:dark:border-slate-700">
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-6 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:-mt-6 sm:px-6 dark:border-slate-700 dark:bg-slate-800/95">
          <h3
            id="bruker-detalj-tittel"
            className="text-lg font-semibold text-slate-900 dark:text-white"
          >
            {t("admin.users.detailsTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.actions.close")}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        {isLoading && <LoadingSpinner />}
        {error && <FeilMelding melding={t("admin.users.detailsLoadFailed")} />}

        {data && (
          <div className="space-y-5">
            {/* Identitet */}
            <DetaljSeksjon title={t("admin.users.detailsIdentity")}>
              <DetaljRad label={t("admin.users.email")} value={data.email} mono />
              <DetaljRad
                label={t("admin.users.name")}
                value={
                  [data.fornavn, data.etternavn].filter(Boolean).join(" ") || data.brukernavn || "—"
                }
              />
              <DetaljRad label={t("admin.users.role")} value={data.rolle} />
              <DetaljRad label={t("admin.users.detailsId")} value={data.id} mono />
              <DetaljRad
                label={t("admin.users.created")}
                value={formaterDatoOgTid(data.opprettet, language)}
              />
              <DetaljRad
                label={t("admin.users.detailsUpdated")}
                value={formaterDatoOgTid(data.oppdatert, language)}
              />
            </DetaljSeksjon>

            {/* Status */}
            <DetaljSeksjon title={t("admin.users.detailsStatus")}>
              {data.deleted && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                  <strong>{t("admin.users.statusDeleted")}</strong>
                  {data.deletedAt && ` · ${formaterDatoOgTid(data.deletedAt, language)}`}
                </div>
              )}
              {data.locked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                  <strong>{t("admin.users.statusLocked")}</strong>
                  {data.lockedAt && ` · ${formaterDatoOgTid(data.lockedAt, language)}`}
                  {data.lockedReason && <div className="mt-1 text-xs">{data.lockedReason}</div>}
                </div>
              )}
              {!data.deleted && !data.locked && (
                <div className="text-sm text-emerald-600 dark:text-emerald-400">
                  ✓ {t("admin.users.statusActive")}
                </div>
              )}
            </DetaljSeksjon>

            {/* Auth */}
            <DetaljSeksjon title={t("admin.users.detailsAuth")}>
              <DetaljRad label={t("admin.users.detailsClerkId")} value={data.clerkId ?? "—"} mono />
              <DetaljRad label={t("admin.users.detailsClerkEnv")} value={data.clerkEnv ?? "—"} />
              <DetaljRad
                label={t("admin.users.detailsClerkSynced")}
                value={
                  data.clerkProfileSyncedAt
                    ? formaterDatoOgTid(data.clerkProfileSyncedAt, language)
                    : "—"
                }
              />
              <DetaljRad label={t("admin.users.detailsMfa")} value={data.mfaEnabled ? "✓" : "—"} />
              {data.mfaEnabled && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => onResetMfa(brukerId)}
                    disabled={isResettingMfa}
                    className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-900/40 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/30"
                  >
                    <ShieldOff size={14} />
                    {t("admin.users.resetMfa")}
                  </button>
                </div>
              )}
              <DetaljRad
                label={t("admin.users.detailsAuthProviders")}
                value={data.authProviders?.join(", ") ?? "—"}
              />
              <DetaljRad
                label={t("admin.users.detailsOauthAccounts")}
                value={String(data.oauthAccountCount)}
              />
              {data.syncConflictCount > 0 && (
                <DetaljRad
                  label={t("admin.users.detailsSyncConflicts")}
                  value={`${data.syncConflictCount} (${data.syncConflictTypes?.join(", ") ?? ""})`}
                  tone="warning"
                />
              )}
            </DetaljSeksjon>

            {/* Canvas (kun status, ALDRI token eller data) */}
            <DetaljSeksjon title={t("admin.users.detailsCanvas")}>
              <DetaljRad
                label={t("admin.users.detailsCanvasConnected")}
                value={data.canvasConnected ? "✓" : "—"}
              />
              {data.canvasConnected && (
                <>
                  <DetaljRad
                    label={t("admin.users.detailsCanvasInstance")}
                    value={data.canvasBaseUrl ?? "—"}
                    mono
                  />
                  <DetaljRad
                    label={t("admin.users.detailsCanvasUserCached")}
                    value={data.canvasUserCached ? "✓" : "—"}
                  />
                </>
              )}
            </DetaljSeksjon>

            {/* Aktiv tid siste 30 dager (fra heartbeats + chat-intervaller) */}
            <DetaljSeksjon title={t("admin.users.detailsActiveTime")}>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                {t("admin.users.detailsActiveTimeNote")}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-900">
                  <div className="text-lg font-semibold text-slate-900 dark:text-white">
                    {formaterTall(data.activity.activeHoursLast30d, language)}{" "}
                    {t("overview.studyActivity.hoursUnit")}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {t("admin.users.activityStats.hoursLast30d")}
                  </div>
                </div>
                <KountKort
                  label={t("admin.users.activityStats.daysLast30d")}
                  value={data.activity.activeDaysLast30d}
                  language={language}
                />
              </div>
            </DetaljSeksjon>

            {/* Aktivitetstellinger (privacy-trygt) */}
            <DetaljSeksjon title={t("admin.users.detailsActivity")}>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                {t("admin.users.detailsActivityNote")}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <KountKort
                  label={t("admin.users.activityCounts.chatHistory")}
                  value={data.counts.chatHistory}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.sharedChats")}
                  value={data.counts.sharedChats}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.taskBreakdowns")}
                  value={data.counts.taskBreakdowns}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.workPlans")}
                  value={data.counts.arbeidsplaner}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.contentEmbeddings")}
                  value={data.counts.contentEmbeddings}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.canvasStructures")}
                  value={data.counts.canvasStructures}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.knowledgeBases")}
                  value={data.counts.knowledgeBases}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.knowledgeBaseChunks")}
                  value={data.counts.knowledgeBaseChunks}
                  language={language}
                />
                <KountKort
                  label={t("admin.users.activityCounts.webPushSubscriptions")}
                  value={data.counts.webPushSubscriptions}
                  language={language}
                />
              </div>
            </DetaljSeksjon>

            {/* Integrasjoner */}
            <DetaljSeksjon title={t("admin.users.detailsIntegrations")}>
              <DetaljRad
                label={t("admin.users.detailsNotion")}
                value={data.notionConfigured ? t("admin.users.detailsConfigured") : "—"}
              />
              <DetaljRad label={t("admin.users.detailsLanguage")} value={data.language ?? "—"} />
              <DetaljRad label={t("admin.users.detailsTheme")} value={data.theme ?? "—"} />
            </DetaljSeksjon>

            {/* Recent audit */}
            <DetaljSeksjon
              title={`${t("admin.users.detailsRecentAudit")} ${
                data.auditFailureCount30d > 0
                  ? t("admin.users.detailsAuditFailureCount30d", {
                      count: formaterTall(data.auditFailureCount30d, language),
                    })
                  : ""
              }`}
            >
              {data.recentAuditEntries.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t("admin.users.detailsNoAudit")}
                </p>
              ) : (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {data.recentAuditEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-0 dark:border-slate-700"
                    >
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {entry.action}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                          entry.outcome === "success"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                        }`}
                      >
                        {entry.outcome}
                      </span>
                      <span className="ml-auto shrink-0 text-slate-500 dark:text-slate-400">
                        {formaterDatoOgTid(entry.createdAt, language)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DetaljSeksjon>

            <div className="border-t border-slate-200 pt-3 text-[10px] italic text-slate-400 dark:border-slate-700">
              {t("admin.users.detailsPrivacyFooter")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetaljSeksjon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetaljRad({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warning";
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`${mono ? "font-mono text-xs" : ""} ${
          tone === "warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-slate-900 dark:text-white"
        } break-all sm:truncate sm:text-right`}
      >
        {value}
      </dd>
    </div>
  );
}

function KountKort({
  label,
  value,
  language,
}: {
  label: string;
  value: number;
  language: "nb" | "en";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-900">
      <div className="text-lg font-semibold text-slate-900 dark:text-white">
        {formaterTall(value, language)}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

// ── Brukere-fane ────────────────────────────────────────────────────────────

function BrukereFane() {
  const { language, t } = useLanguage();
  const megQuery = useMeg();
  const minId = megQuery.data?.user?.id;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminBrukereStatusFilter>("active");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Enkel debounce
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setOffset(0);
    }, 400);
  };

  const { data, isLoading, error } = useAdminBrukere({
    limit,
    offset,
    search: debouncedSearch || undefined,
    status: statusFilter,
  });
  const endreRolle = useEndreRolle();
  const slettBruker = useSlettBruker();
  const clearRelinkGuard = useClearRedisRelinkState();
  const lockUser = useLockUser();
  const unlockUser = useUnlockUser();
  const revokeSessions = useRevokeUserSessions();
  const resendVerification = useResendVerification();
  const resetMfa = useResetUserMfa();

  const [bekreftSlett, setBekreftSlett] = useState<string | null>(null);
  const [lockDialog, setLockDialog] = useState<{ id: string; email: string } | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [detaljId, setDetaljId] = useState<string | null>(null);

  const handleEndreRolle = (bruker: AdminBruker) => {
    if (bruker.id === minId) {
      showToast.error(t("admin.users.cannotChangeSelf"));
      return;
    }
    const nyRolle = bruker.rolle === "admin" ? "user" : "admin";
    endreRolle.mutate(
      { brukerId: bruker.id, rolle: nyRolle },
      {
        onSuccess: () => showToast.success(t("admin.users.roleChanged")),
        onError: (err) =>
          showToast.error(err instanceof Error ? err.message : t("admin.errors.roleChangeFailed")),
      },
    );
  };

  const handleOpenLockDialog = (bruker: AdminBruker) => {
    if (bruker.id === minId) {
      showToast.error(t("admin.users.cannotLockSelf"));
      return;
    }
    if (bruker.rolle === "admin") {
      showToast.error(t("admin.users.cannotLockAdmin"));
      return;
    }
    setLockReason("");
    setLockDialog({ id: bruker.id, email: bruker.email });
  };

  const handleConfirmLock = () => {
    if (!lockDialog) return;
    lockUser.mutate(
      {
        brukerId: lockDialog.id,
        reason: lockReason.trim() || undefined,
      },
      {
        onSuccess: () => {
          showToast.success(t("admin.users.lockSuccess"));
          setLockDialog(null);
          setLockReason("");
        },
        onError: (err) =>
          showToast.error(err instanceof Error ? err.message : t("admin.users.lockFailed")),
      },
    );
  };

  const handleRevokeSessions = (bruker: AdminBruker) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.users.revokeSessionsConfirm"),
      handlingstekst: t("admin.users.revokeSessions"),
      onBekreft: () => {
        revokeSessions.mutate(bruker.id, {
          onSuccess: (result) =>
            showToast.success(`${t("admin.users.revokeSessionsSuccess")} (${result.revoked})`),
          onError: (err) =>
            showToast.error(
              err instanceof Error ? err.message : t("admin.users.revokeSessionsFailed"),
            ),
        });
      },
    });
  };

  const handleResendVerification = (bruker: AdminBruker) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.users.resendVerificationConfirm"),
      handlingstekst: t("admin.users.resendVerification"),
      onBekreft: () => {
        resendVerification.mutate(bruker.id, {
          onSuccess: () => showToast.success(t("admin.users.resendVerificationSuccess")),
          onError: (err) =>
            showToast.error(
              err instanceof Error ? err.message : t("admin.users.resendVerificationFailed"),
            ),
        });
      },
    });
  };

  const handleResetMfa = (bruker: AdminBruker) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.users.resetMfaConfirm"),
      handlingstekst: t("admin.users.resetMfa"),
      onBekreft: () => {
        resetMfa.mutate(bruker.id, {
          onSuccess: (result) => {
            showToast.success(t("admin.users.resetMfaSuccess"));
            // MFA er deaktivert i Clerk, men sesjonsrevoke feilet — advar
            // admin slik at de kan trykke "logg ut alle sesjoner" manuelt
            // som separat handling (bekreftelsesteksten lovet utlogging).
            if (!result.sessionsRevoked) {
              showToast.warning(
                t("admin.users.resetMfaSessionsNotRevokedTitle"),
                t("admin.users.resetMfaSessionsNotRevokedDescription"),
              );
            }
          },
          onError: (err) =>
            showToast.error(
              err instanceof Error ? err.message : t("admin.users.resetMfaFailed"),
            ),
        });
      },
    });
  };

  const handleUnlock = (bruker: AdminBruker) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.users.unlockConfirm"),
      handlingstekst: t("admin.users.unlockUser"),
      onBekreft: () => {
        unlockUser.mutate(bruker.id, {
          onSuccess: () => showToast.success(t("admin.users.unlockSuccess")),
          onError: (err) =>
            showToast.error(err instanceof Error ? err.message : t("admin.users.unlockFailed")),
        });
      },
    });
  };

  const handleClearRelinkGuard = (brukerId: string) => {
    clearRelinkGuard.mutate(brukerId, {
      onSuccess: () => showToast.success(t("admin.users.relinkGuardCleared")),
      onError: (err) =>
        showToast.error(
          err instanceof Error ? err.message : t("admin.users.relinkGuardClearFailed"),
        ),
    });
  };

  const handleSlett = (brukerId: string) => {
    if (brukerId === minId) {
      showToast.error(t("admin.users.cannotDeleteSelf"));
      return;
    }
    slettBruker.mutate(brukerId, {
      onSuccess: (result) => {
        if (result.providerAccountDeleted && result.vectorCleanupSucceeded) {
          showToast.success(t("admin.users.userDeleted"));
        } else {
          showToast.warning(t("admin.users.userDeleted"), t("admin.users.userDeletedPartial"));
        }
        setBekreftSlett(null);
      },
      onError: (err) =>
        showToast.error(err instanceof Error ? err.message : t("admin.errors.deleteFailed")),
    });
  };

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;

  return (
    <div className="space-y-4">
      {/* Lås konto-dialog */}
      {lockDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lock-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLockDialog(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <h3
              id="lock-dialog-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              {t("admin.users.lockConfirmTitle")}
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t("admin.users.lockConfirmDescription")}
            </p>
            <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
              {lockDialog.email}
            </p>

            <label className="mt-4 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("admin.users.lockReasonLabel")}
            </label>
            <textarea
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t("admin.users.lockReasonPlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <div className="mt-1 text-right text-[10px] text-slate-400">
              {lockReason.length}/500
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLockDialog(null)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmLock}
                disabled={lockUser.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Lock size={14} />
                {t("admin.users.lockConfirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brukerdetalj-modal */}
      {detaljId && (
        <BrukerDetaljModal
          brukerId={detaljId}
          onClose={() => setDetaljId(null)}
          onResetMfa={(id) => {
            const bruker = data?.brukere.find((b) => b.id === id);
            if (bruker) handleResetMfa(bruker);
          }}
          isResettingMfa={resetMfa.isPending}
        />
      )}

      {/* Søk + status-filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("admin.users.searchPlaceholder")}
            aria-label={t("admin.users.searchPlaceholder")}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as AdminBrukereStatusFilter);
            setOffset(0);
          }}
          aria-label={t("admin.users.statusFilterLabel")}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:w-48"
        >
          <option value="active">{t("admin.users.statusActive")}</option>
          <option value="locked">{t("admin.users.statusLocked")}</option>
          <option value="deleted">{t("admin.users.statusDeleted")}</option>
          <option value="all">{t("admin.users.statusAll")}</option>
        </select>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <FeilMelding melding={t("admin.errors.usersFailed")} />}

      {data && (
        <>
          {/* Tabell */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-180 text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t("admin.users.email")}</th>
                  <th className="px-4 py-3">{t("admin.users.name")}</th>
                  <th className="px-4 py-3">{t("admin.users.role")}</th>
                  <th className="px-4 py-3">{t("admin.users.canvas")}</th>
                  <th className="px-4 py-3">{t("admin.users.provider")}</th>
                  <th className="px-4 py-3">{t("admin.users.created")}</th>
                  <th className="px-4 py-3">{t("admin.users.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.brukere.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                    >
                      {t("admin.users.noUsers")}
                    </td>
                  </tr>
                ) : (
                  data.brukere.map((bruker) => {
                    const erDeg = bruker.id === minId;
                    return (
                      <tr
                        key={bruker.id}
                        className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-slate-900 dark:text-white">
                          {bruker.email}
                          {erDeg && (
                            <span className="ml-1.5 text-xs text-sky-600 dark:text-sky-400 font-medium">
                              {t("admin.users.you")}
                            </span>
                          )}
                          {bruker.locked && (
                            <span
                              title={bruker.lockedReason ?? undefined}
                              className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            >
                              <Lock size={10} />
                              {t("admin.users.lockedBadge")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {[bruker.fornavn, bruker.etternavn].filter(Boolean).join(" ") ||
                            bruker.brukernavn ||
                            "–"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              bruker.rolle === "admin"
                                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {bruker.rolle === "admin" && <Shield size={12} />}
                            {bruker.rolle}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {bruker.harCanvasToken ? (
                            <Check size={16} className="text-green-500" />
                          ) : (
                            <X size={16} className="text-slate-300 dark:text-slate-600" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 capitalize">
                            {bruker.authProviders && bruker.authProviders.length > 0
                              ? bruker.authProviders.join(", ")
                              : "–"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formaterDatoLong(bruker.opprettet, language)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!erDeg && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setDetaljId(bruker.id)}
                                  title={t("admin.users.viewDetails")}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                >
                                  <Info size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEndreRolle(bruker)}
                                  disabled={endreRolle.isPending}
                                  title={t("admin.users.changeRole")}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-sky-600 dark:hover:text-sky-400 transition-colors disabled:opacity-50"
                                >
                                  <ShieldCheck size={16} />
                                </button>
                                {bekreftSlett === bruker.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                      {t("admin.users.deleteConfirm")}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleSlett(bruker.id)}
                                      disabled={slettBruker.isPending}
                                      aria-label={t("admin.users.deleteUser")}
                                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBekreftSlett(null)}
                                      aria-label={t("common.actions.cancel")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleClearRelinkGuard(bruker.id)}
                                      disabled={clearRelinkGuard.isPending}
                                      title={t("admin.users.clearRelinkGuard")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50"
                                    >
                                      <Unlock size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeSessions(bruker)}
                                      disabled={revokeSessions.isPending}
                                      title={t("admin.users.revokeSessions")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                                    >
                                      <LogOut size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleResendVerification(bruker)}
                                      disabled={resendVerification.isPending}
                                      title={t("admin.users.resendVerification")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
                                    >
                                      <MailCheck size={16} />
                                    </button>
                                    {bruker.mfaEnabled && (
                                      <button
                                        type="button"
                                        onClick={() => handleResetMfa(bruker)}
                                        disabled={resetMfa.isPending}
                                        title={t("admin.users.resetMfa")}
                                        className="rounded-lg p-1.5 text-slate-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:text-orange-600 dark:hover:text-orange-400 transition-colors disabled:opacity-50"
                                      >
                                        <ShieldOff size={16} />
                                      </button>
                                    )}
                                    {bruker.locked ? (
                                      <button
                                        type="button"
                                        onClick={() => handleUnlock(bruker)}
                                        disabled={unlockUser.isPending}
                                        title={t("admin.users.unlockUser")}
                                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                                      >
                                        <LockOpen size={16} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenLockDialog(bruker)}
                                        disabled={
                                          lockUser.isPending ||
                                          bruker.id === minId ||
                                          bruker.rolle === "admin"
                                        }
                                        title={
                                          bruker.id === minId
                                            ? t("admin.users.cannotLockSelf")
                                            : bruker.rolle === "admin"
                                              ? t("admin.users.cannotLockAdmin")
                                              : t("admin.users.lockUser")
                                        }
                                        className="rounded-lg p-1.5 text-slate-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <Lock size={16} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setBekreftSlett(bruker.id)}
                                      title={t("admin.users.deleteUser")}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginering */}
          {total > limit && (
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
              <span>
                {offset + 1}–{Math.min(offset + limit, total)} / {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  disabled={!harForrige}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + limit)}
                  disabled={!harNeste}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Revisjonslogg-fane ──────────────────────────────────────────────────────

function RevisjonsloggFane() {
  const { language, t } = useLanguage();
  const [offset, setOffset] = useState(0);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "success" | "failure">("all");
  const [categoryFilter, setCategoryFilter] = useState<AdminAuditCategory | "all">("all");
  const [targetUserIdFilter, setTargetUserIdFilter] = useState("");
  const [actorUserIdFilter, setActorUserIdFilter] = useState("");
  const [debouncedTargetUserId, setDebouncedTargetUserId] = useState("");
  const [debouncedActorUserId, setDebouncedActorUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = 50;
  const kategorier: AdminAuditCategory[] = [
    "admin",
    "auth",
    "integration",
    "ki",
    "privacy",
    "profile",
    "security",
  ];

  useEffect(
    () => () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      setDebouncedTargetUserId(targetUserIdFilter.trim());
      setDebouncedActorUserId(actorUserIdFilter.trim());
      setOffset(0);
    }, 400);

    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, [targetUserIdFilter, actorUserIdFilter]);

  const { data, isLoading, error } = useAdminAudit({
    limit,
    offset,
    category: categoryFilter === "all" ? undefined : categoryFilter,
    outcome: outcomeFilter === "all" ? undefined : outcomeFilter,
    targetUserId: debouncedTargetUserId || undefined,
    actorUserId: debouncedActorUserId || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  });

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;
  const valgtItem = data?.items.find((item) => item.id === selectedAuditId) ?? null;

  useEffect(() => {
    if (!data?.items.length) {
      setSelectedAuditId(null);
      return;
    }

    if (!selectedAuditId || !data.items.some((item) => item.id === selectedAuditId)) {
      setSelectedAuditId(data.items[0].id);
    }
  }, [data?.items, selectedAuditId]);

  const buildExportParams = () => {
    const sp = new URLSearchParams();
    if (categoryFilter !== "all") sp.set("category", categoryFilter);
    if (outcomeFilter !== "all") sp.set("outcome", outcomeFilter);
    if (debouncedTargetUserId) sp.set("targetUserId", debouncedTargetUserId);
    if (debouncedActorUserId) sp.set("actorUserId", debouncedActorUserId);
    if (fromDate) sp.set("from", fromDate);
    if (toDate) sp.set("to", toDate);
    return sp;
  };

  const handleExportCsv = async () => {
    const sp = buildExportParams();
    const url = `/api/admin/audit/export.csv${sp.toString() ? `?${sp.toString()}` : ""}`;

    try {
      await downloadAuthedFile(url, "audit-export.csv");
    } catch (error) {
      showToast.error(
        t("admin.audit.exportFailed"),
        hentFeilmelding(error, t("admin.audit.exportFailed")),
      );
    }
  };

  const handleExportTxt = async () => {
    const sp = buildExportParams();
    const url = `/api/admin/audit/export.txt${sp.toString() ? `?${sp.toString()}` : ""}`;

    try {
      await downloadAuthedFile(url, "audit-export.txt");
    } catch (error) {
      showToast.error(
        t("admin.audit.exportFailed"),
        hentFeilmelding(error, t("admin.audit.exportFailed")),
      );
    }
  };

  const resetFilters = () => {
    setOutcomeFilter("all");
    setCategoryFilter("all");
    setTargetUserIdFilter("");
    setActorUserIdFilter("");
    setDebouncedTargetUserId("");
    setDebouncedActorUserId("");
    setFromDate("");
    setToDate("");
    setOffset(0);
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <FeilMelding melding={t("admin.errors.auditFailed")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("admin.audit.title")}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t("admin.audit.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <X size={14} />
              {t("admin.audit.resetFilters")}
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FileUp size={14} />
              {t("admin.audit.exportCsv")}
            </button>
            <button
              type="button"
              onClick={() => void handleExportTxt()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FileText size={14} />
              {t("admin.audit.exportTxt")}
            </button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <select
            value={outcomeFilter}
            onChange={(e) => {
              setOutcomeFilter(e.target.value as "all" | "success" | "failure");
              setOffset(0);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="all">{t("admin.audit.outcomeAll")}</option>
            <option value="success">{t("admin.audit.outcomeSuccess")}</option>
            <option value="failure">{t("admin.audit.outcomeFailure")}</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value as AdminAuditCategory | "all");
              setOffset(0);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="all">{t("admin.audit.categoryAll")}</option>
            {kategorier.map((kategori) => (
              <option key={kategori} value={kategori}>
                {kategori}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={targetUserIdFilter}
            onChange={(e) => setTargetUserIdFilter(e.target.value)}
            placeholder={t("admin.audit.targetUserIdPlaceholder")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <input
            type="text"
            value={actorUserIdFilter}
            onChange={(e) => setActorUserIdFilter(e.target.value)}
            placeholder={t("admin.audit.actorUserIdPlaceholder")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setOffset(0);
            }}
            aria-label={t("admin.audit.fromDate")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setOffset(0);
            }}
            aria-label={t("admin.audit.toDate")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3">{t("admin.audit.action")}</th>
              <th className="px-4 py-3">{t("admin.audit.category")}</th>
              <th className="px-4 py-3">{t("admin.audit.outcome")}</th>
              <th className="px-4 py-3">{t("admin.audit.actor")}</th>
              <th className="px-4 py-3">{t("admin.audit.target")}</th>
              <th className="px-4 py-3">{t("admin.audit.time")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {!data || data.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                >
                  {t("admin.audit.noEntries")}
                </td>
              </tr>
            ) : (
              data.items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedAuditId(item.id)}
                  className={`cursor-pointer transition-colors ${
                    selectedAuditId === item.id
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : "bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <td className="px-4 py-3 text-slate-900 dark:text-white font-mono text-xs">
                    {item.action}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        item.outcome === "success"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {item.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs truncate max-w-30">
                    {item.actorUserId}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs truncate max-w-30">
                    {item.targetUserId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formaterDatoOgTid(item.createdAt, language)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {offset + 1}–{Math.min(offset + limit, total)} / {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={!harForrige}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + limit)}
              disabled={!harNeste}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {valgtItem && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("admin.audit.detailsTitle")}
            </h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {valgtItem.category}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetaljRad label={t("admin.audit.action")} value={valgtItem.action} mono />
            <DetaljRad label={t("admin.audit.actor")} value={valgtItem.actorUserId} mono />
            <DetaljRad label={t("admin.audit.target")} value={valgtItem.targetUserId ?? "—"} mono />
            <DetaljRad label={t("admin.audit.role")} value={valgtItem.role ?? "—"} />
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("admin.audit.metadata")}
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formaterDatoOgTid(valgtItem.createdAt, language)}
              </span>
            </div>
            {valgtItem.metadata && Object.keys(valgtItem.metadata).length > 0 ? (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                {JSON.stringify(valgtItem.metadata, null, 2)}
              </pre>
            ) : (
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                {t("admin.audit.noMetadata")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feedback-fane ──────────────────────────────────────────────────────────

function FeedbackFane() {
  const { language, t } = useLanguage();
  const [rating, setRating] = useState<AdminFeedbackRating>("down");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading, error } = useAdminFeedback({
    rating,
    limit: 100,
  });
  const triage = useAdminFeedbackTriage();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <FeilMelding melding={t("admin.feedback.loadFailed")} />;

  return (
    <div className="space-y-4">
      {triage.data && triage.data.groups.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("admin.feedbackTriage.title")}
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t("admin.feedbackTriage.windowNote", {
                days: String(triage.data.windowDays),
              })}
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-4 text-left font-medium">
                    {t("admin.feedbackTriage.columnIntent")}
                  </th>
                  <th className="py-2 pr-4 text-left font-medium">
                    {t("admin.feedbackTriage.columnDown")}
                  </th>
                  <th className="py-2 pr-4 text-left font-medium">
                    {t("admin.feedbackTriage.columnUp")}
                  </th>
                  <th className="py-2 pr-4 text-left font-medium">
                    {t("admin.feedbackTriage.columnRate")}
                  </th>
                  <th className="py-2 text-left font-medium">
                    {t("admin.feedbackTriage.columnLastAt")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {triage.data.groups.map((g) => {
                  const total = g.downCount + g.upCount;
                  const rate = total > 0 ? Math.round((g.downCount / total) * 100) : 0;
                  const rateClass =
                    rate >= 50
                      ? "text-red-600 dark:text-red-400"
                      : rate >= 25
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-slate-500 dark:text-slate-400";
                  return (
                    <tr key={g.intent}>
                      <td className="py-2 pr-4">
                        <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                          {g.intent}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-700 dark:text-slate-300">
                        {g.downCount}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-500 dark:text-slate-400">
                        {g.upCount}
                      </td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${rateClass}`}>
                        {rate}%
                      </td>
                      <td className="py-2 text-slate-500 dark:text-slate-400">
                        {g.lastAt ? formaterDatoOgTid(g.lastAt, language) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {(["down", "up"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={`rounded-lg border px-3 py-1 text-sm ${
                rating === value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200"
              }`}
            >
              {value === "down" ? t("admin.feedback.bad") : t("admin.feedback.good")}
              {data ? ` (${data.totals[value]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {data && data.items.length === 0 && (
        <p className="text-sm italic text-slate-500">{t("admin.feedback.empty")}</p>
      )}

      <ul className="space-y-3">
        {data?.items.map((item: AdminFeedbackItem) => {
          const expanded = expandedId === item.id;
          return (
            <li
              key={item.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {item.user?.email ?? item.user?.username ?? t("admin.feedback.anonymous")}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formaterDatoOgTid(item.createdAt, language)}
                  </p>
                </div>
              </div>

              {item.question && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    {t("admin.feedback.question")}
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{item.question}</p>
                </div>
              )}

              {item.answer && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    {t("admin.feedback.answer")}
                  </p>
                  <p
                    className={`text-sm text-slate-600 dark:text-slate-400 ${expanded ? "" : "line-clamp-4"}`}
                  >
                    {item.answer}
                  </p>
                  {item.answer.length > 280 && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {expanded ? t("admin.feedback.showLess") : t("admin.feedback.showMore")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Køer-fane (BullMQ) ──────────────────────────────────────────────────────

function KøerFane() {
  const { language, t } = useLanguage();
  const [valgtKø, setValgtKø] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QueueJobStatus>("failed");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const overviewQuery = useQueueOverview();
  const jobsQuery = useQueueJobs(valgtKø, statusFilter);
  const pauseMutation = usePauseQueue();
  const resumeMutation = useResumeQueue();
  const retryMutation = useRetryQueueJob();
  const removeMutation = useRemoveQueueJob();

  // Velg første kø automatisk når data lastes
  useEffect(() => {
    if (!valgtKø && overviewQuery.data?.queues.length) {
      setValgtKø(overviewQuery.data.queues[0].name);
    }
  }, [valgtKø, overviewQuery.data]);

  useEffect(() => {
    if (!jobsQuery.data?.jobs.length) {
      setSelectedJobId(null);
      return;
    }

    if (!selectedJobId || !jobsQuery.data.jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobsQuery.data.jobs[0].id);
    }
  }, [jobsQuery.data?.jobs, selectedJobId]);

  const handleRetry = (jobId: string) => {
    if (!valgtKø) return;
    retryMutation.mutate(
      { queueName: valgtKø, jobId },
      {
        onSuccess: () => showToast.success(t("admin.queues.actions.retrySuccess")),
        onError: (error) =>
          showToast.error(
            t("admin.queues.actions.retryFailed"),
            hentFeilmelding(error, t("admin.queues.actions.retryFailed")),
          ),
      },
    );
  };

  const handleRemove = (jobId: string) => {
    if (!valgtKø) return;
    visBekreftelsesToast({
      t,
      melding: t("admin.queues.actions.confirmRemove"),
      handlingstekst: t("common.actions.delete"),
      onBekreft: () => {
        removeMutation.mutate(
          { queueName: valgtKø, jobId },
          {
            onSuccess: () => showToast.success(t("admin.queues.actions.removeSuccess")),
            onError: (error) =>
              showToast.error(
                t("admin.queues.actions.removeFailed"),
                hentFeilmelding(error, t("admin.queues.actions.removeFailed")),
              ),
          },
        );
      },
    });
  };

  const handlePauseResume = (queueName: string, isPaused: boolean) => {
    const mutation = isPaused ? resumeMutation : pauseMutation;
    const successMessage = isPaused
      ? t("admin.queues.actions.resumeSuccess")
      : t("admin.queues.actions.pauseSuccess");
    const errorMessage = isPaused
      ? t("admin.queues.actions.resumeFailed")
      : t("admin.queues.actions.pauseFailed");

    mutation.mutate(queueName, {
      onSuccess: () => showToast.success(successMessage),
      onError: (error) => showToast.error(errorMessage, hentFeilmelding(error, errorMessage)),
    });
  };

  if (overviewQuery.isLoading) return <LoadingSpinner />;
  if (overviewQuery.error) return <FeilMelding melding={t("admin.queues.loadFailed")} />;

  const queues = overviewQuery.data?.queues ?? [];
  const valgtKøData = queues.find((queue) => queue.name === valgtKø) ?? null;
  const valgtJobb = jobsQuery.data?.jobs.find((job) => job.id === selectedJobId) ?? null;
  if (queues.length === 0) return <FeilMelding melding={t("admin.queues.empty")} />;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.queues.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t("admin.queues.description")}
        </p>
      </div>

      {/* Kø-kort */}
      <div className="grid gap-3 sm:grid-cols-2">
        {queues.map((q: AdminQueueOverviewItem) => {
          const aktiv = valgtKø === q.name;
          return (
            <button
              key={q.name}
              type="button"
              onClick={() => setValgtKø(q.name)}
              className={`text-left rounded-xl border p-4 transition-colors ${
                aktiv
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={16} className="text-slate-500 dark:text-slate-400" />
                  <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">
                    {q.name}
                  </span>
                </div>
                {q.isPaused && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {t("admin.queues.counts.paused")}
                  </span>
                )}
              </div>
              {(q.deadLetterCount ?? 0) > 0 && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <AlertTriangle size={13} />
                  {t("admin.queues.deadLetterWarning", {
                    count: `${q.deadLetterCount ?? 0}${(q.deadLetterCount ?? 0) >= 100 ? "+" : ""}`,
                  })}
                </div>
              )}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <KøCount label={t("admin.queues.counts.waiting")} value={q.counts.waiting} />
                <KøCount label={t("admin.queues.counts.active")} value={q.counts.active} />
                <KøCount label={t("admin.queues.counts.delayed")} value={q.counts.delayed} />
                <KøCount
                  label={t("admin.queues.counts.completed")}
                  value={q.counts.completed}
                  tone="success"
                />
                <KøCount
                  label={t("admin.queues.counts.failed")}
                  value={q.counts.failed}
                  tone="danger"
                />
              </dl>
              {q.jobTypeCounts && q.jobTypeCounts.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    {t("admin.queues.perJobType")}
                  </p>
                  <div className="space-y-1.5">
                    {q.jobTypeCounts.map((jt) => (
                      <div key={jt.name} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {jt.name}
                        </span>
                        <div className="flex gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {jt.waiting > 0 && (
                            <span>
                              {t("admin.queues.counts.waiting")}: {jt.waiting}
                            </span>
                          )}
                          {jt.active > 0 && (
                            <span>
                              {t("admin.queues.counts.active")}: {jt.active}
                            </span>
                          )}
                          {jt.delayed > 0 && (
                            <span>
                              {t("admin.queues.counts.delayed")}: {jt.delayed}
                            </span>
                          )}
                          {jt.completed > 0 && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {jt.completed}
                            </span>
                          )}
                          {jt.failed > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              {t("admin.queues.counts.failed")}: {jt.failed}
                            </span>
                          )}
                          {jt.waiting === 0 &&
                            jt.active === 0 &&
                            jt.delayed === 0 &&
                            jt.completed === 0 &&
                            jt.failed === 0 && <span>0</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {q.jobTypeCounts.some(
                    (jt) =>
                      jt.waiting >= 500 ||
                      jt.active >= 500 ||
                      jt.delayed >= 500 ||
                      jt.completed >= 500 ||
                      jt.failed >= 500,
                  ) && (
                    <p className="mt-1.5 text-[9px] italic text-slate-400 dark:text-slate-500">
                      {t("admin.queues.sampledNote")}
                    </p>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Jobb-liste */}
      {valgtKø && valgtKøData && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t("admin.queues.jobsTitle")} — <span className="font-mono">{valgtKø}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as QueueJobStatus)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="failed">{t("admin.queues.counts.failed")}</option>
                  <option value="waiting">{t("admin.queues.counts.waiting")}</option>
                  <option value="active">{t("admin.queues.counts.active")}</option>
                  <option value="delayed">{t("admin.queues.counts.delayed")}</option>
                  <option value="completed">{t("admin.queues.counts.completed")}</option>
                  <option value="paused">{t("admin.queues.counts.paused")}</option>
                </select>
                <button
                  type="button"
                  onClick={() => handlePauseResume(valgtKøData.name, valgtKøData.isPaused)}
                  disabled={pauseMutation.isPending || resumeMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {valgtKøData.isPaused ? <Play size={14} /> : <Pause size={14} />}
                  {valgtKøData.isPaused
                    ? t("admin.queues.actions.resumeQueue")
                    : t("admin.queues.actions.pauseQueue")}
                </button>
                <button
                  type="button"
                  onClick={() => jobsQuery.refetch()}
                  disabled={jobsQuery.isFetching}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50"
                >
                  <RefreshCcw size={12} className={jobsQuery.isFetching ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {t("admin.queues.selectedStatus")}: <strong>{statusFilter}</strong>
              </span>
              <span>
                {t("admin.queues.counts.waiting")}:{" "}
                <strong>{formaterTall(valgtKøData.counts.waiting, language)}</strong>
              </span>
              <span>
                {t("admin.queues.counts.failed")}:{" "}
                <strong>{formaterTall(valgtKøData.counts.failed, language)}</strong>
              </span>
            </div>
          </div>
          {jobsQuery.isLoading ? (
            <div className="p-4">
              <LoadingSpinner />
            </div>
          ) : jobsQuery.data && jobsQuery.data.jobs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left">{t("admin.queues.columns.id")}</th>
                    <th className="px-4 py-2 text-left">{t("admin.queues.columns.name")}</th>
                    <th className="px-4 py-2 text-left">{t("admin.queues.columns.status")}</th>
                    <th className="px-4 py-2 text-left">{t("admin.queues.columns.attempts")}</th>
                    <th className="px-4 py-2 text-left">
                      {t("admin.queues.columns.failedReason")}
                    </th>
                    <th className="px-4 py-2 text-left">{t("admin.queues.columns.timestamp")}</th>
                    <th className="px-4 py-2 text-right">{t("admin.queues.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {jobsQuery.data.jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`cursor-pointer text-slate-800 dark:text-slate-200 ${
                        selectedJobId === job.id
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : "bg-white dark:bg-slate-900"
                      }`}
                    >
                      <td className="px-4 py-2 font-mono text-xs">{job.id}</td>
                      <td className="px-4 py-2 text-xs">{job.name}</td>
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {job.attemptsMade}/{job.maxAttempts}
                      </td>
                      <td
                        className="px-4 py-2 max-w-md truncate text-xs text-red-600 dark:text-red-400"
                        title={job.failedReason}
                      >
                        {job.failedReason ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {formaterDatoOgTid(new Date(job.timestamp), language)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          {job.status === "failed" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRetry(job.id);
                              }}
                              disabled={retryMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                            >
                              <PlayCircle size={12} />
                              {t("admin.queues.actions.retry")}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemove(job.id);
                            }}
                            disabled={removeMutation.isPending}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            <Trash2 size={12} />
                            {t("admin.queues.actions.remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t("admin.queues.noJobs")}
            </p>
          )}
        </div>
      )}

      {valgtJobb && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("admin.queues.details.title")}
            </h3>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {valgtJobb.id}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetaljRad label={t("admin.queues.columns.name")} value={valgtJobb.name} />
            <DetaljRad label={t("admin.queues.columns.status")} value={valgtJobb.status} />
            <DetaljRad
              label={t("admin.queues.columns.attempts")}
              value={`${valgtJobb.attemptsMade}/${valgtJobb.maxAttempts}`}
            />
            <DetaljRad
              label={t("admin.queues.details.delay")}
              value={valgtJobb.delay ? `${formaterTall(valgtJobb.delay, language)} ms` : "—"}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("admin.queues.details.timeline")}
              </p>
              <div className="mt-3 space-y-2">
                <DetaljRad
                  label={t("admin.queues.columns.timestamp")}
                  value={formaterDatoOgTid(new Date(valgtJobb.timestamp), language)}
                />
                <DetaljRad
                  label={t("admin.queues.details.processedOn")}
                  value={
                    valgtJobb.processedOn
                      ? formaterDatoOgTid(new Date(valgtJobb.processedOn), language)
                      : "—"
                  }
                />
                <DetaljRad
                  label={t("admin.queues.details.finishedOn")}
                  value={
                    valgtJobb.finishedOn
                      ? formaterDatoOgTid(new Date(valgtJobb.finishedOn), language)
                      : "—"
                  }
                />
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("admin.queues.details.failedReason")}
              </p>
              <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
                {valgtJobb.failedReason ?? "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("admin.queues.details.payload")}
              </p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                {JSON.stringify(valgtJobb.data, null, 2)}
              </pre>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {t("admin.queues.details.stacktrace")}
              </p>
              {valgtJobb.stacktrace && valgtJobb.stacktrace.length > 0 ? (
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  {valgtJobb.stacktrace.join("\n\n")}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  {t("admin.queues.details.noStacktrace")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function KøCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "text-red-600 dark:text-red-400"
        : "text-slate-900 dark:text-white";
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

// ── Redis-fane ──────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}t`;
  if (h > 0) return `${h}t ${m}m`;
  return `${m}m`;
}

function RedisFane() {
  const { language, t } = useLanguage();
  const infoQuery = useRedisInfo();
  const prefixesQuery = useRedisPrefixes();
  const relinkQuery = useRedisRelinkStates();
  const flushMutation = useRedisFlushPrefix();
  const clearRelinkMutation = useClearRedisRelinkState();

  const handleFlush = (prefix: string) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.redis.prefixes.confirmFlush"),
      handlingstekst: t("common.actions.clearAll"),
      onBekreft: () =>
        flushMutation.mutate(prefix, {
          onSuccess: (result) =>
            showToast.success(`${t("admin.redis.prefixes.flushSuccess")}: ${result.deletedCount}`),
          onError: (error) =>
            showToast.error(
              t("admin.redis.prefixes.flushFailed"),
              hentFeilmelding(error, t("admin.redis.prefixes.flushFailed")),
            ),
        }),
    });
  };

  const handleClearRelink = (userId: string) => {
    clearRelinkMutation.mutate(userId, {
      onSuccess: () => showToast.success(t("admin.redis.relinkStates.clearSuccess")),
      onError: (error) =>
        showToast.error(
          t("admin.redis.relinkStates.clearFailed"),
          hentFeilmelding(error, t("admin.redis.relinkStates.clearFailed")),
        ),
    });
  };

  if (infoQuery.isLoading) return <LoadingSpinner />;
  if (infoQuery.error) return <FeilMelding melding={t("admin.redis.loadFailed")} />;

  const info = infoQuery.data;
  if (!info?.connected) {
    return <FeilMelding melding={t("admin.redis.disconnected")} />;
  }

  const memoryUsedPct =
    info.maxMemoryBytes > 0
      ? Math.min(100, Math.round((info.usedMemoryBytes / info.maxMemoryBytes) * 100))
      : null;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.redis.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t("admin.redis.description")}
        </p>
      </div>

      {/* Server-info */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Server size={16} />
          {t("admin.redis.info.sectionTitle")}
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <RedisInfoItem label={t("admin.redis.info.version")} value={info.redisVersion} />
          <RedisInfoItem
            label={t("admin.redis.info.uptime")}
            value={formatUptime(info.uptimeSeconds)}
          />
          <RedisInfoItem
            label={t("admin.redis.info.connectedClients")}
            value={String(info.connectedClients)}
          />
          <RedisInfoItem
            label={t("admin.redis.info.evictionPolicy")}
            value={info.evictionPolicy}
            tone={info.evictionPolicy === "allkeys-lru" ? "warning" : undefined}
          />
          <RedisInfoItem
            label={t("admin.redis.info.usedMemory")}
            value={
              memoryUsedPct != null
                ? `${info.usedMemoryHuman} (${memoryUsedPct}%)`
                : info.usedMemoryHuman
            }
          />
          <RedisInfoItem
            label={t("admin.redis.info.peakMemory")}
            value={info.usedMemoryPeakHuman}
          />
          <RedisInfoItem
            label={t("admin.redis.info.maxMemory")}
            value={info.maxMemoryBytes > 0 ? info.maxMemoryHuman : "—"}
          />
          <RedisInfoItem
            label={t("admin.redis.info.hitRate")}
            value={info.hitRate != null ? `${(info.hitRate * 100).toFixed(1)}%` : "—"}
            tone={info.hitRate != null && info.hitRate < 0.5 ? "warning" : "success"}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {t("admin.redis.info.hits")}:{" "}
            <strong>{formaterTall(info.keyspaceHits, language)}</strong>
          </span>
          <span>
            {t("admin.redis.info.misses")}:{" "}
            <strong>{formaterTall(info.keyspaceMisses, language)}</strong>
          </span>
          <span>
            {t("admin.redis.info.dbSizes")}:{" "}
            {Object.entries(info.dbSizes)
              .map(([db, n]) => `${db}=${formaterTall(n, language)}`)
              .join(", ") || "—"}
          </span>
        </div>
      </div>

      {/* Prefiks-tabell */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Database size={16} />
            {t("admin.redis.prefixes.sectionTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.redis.prefixes.description")}
          </p>
        </div>
        {prefixesQuery.isLoading ? (
          <div className="p-4">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">{t("admin.redis.prefixes.prefix")}</th>
                  <th className="px-4 py-2 text-left">{t("admin.redis.prefixes.label")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.prefixes.count")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.prefixes.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {(prefixesQuery.data?.prefixes ?? []).map((p: AdminRedisPrefix) => (
                  <tr key={p.prefix} className="text-slate-800 dark:text-slate-200">
                    <td className="px-4 py-2 font-mono text-xs">{p.prefix}</td>
                    <td className="px-4 py-2">{p.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formaterTall(p.count, language)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.canFlush ? (
                        <button
                          type="button"
                          onClick={() => handleFlush(p.prefix)}
                          disabled={flushMutation.isPending || p.count === 0}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={12} />
                          {t("admin.redis.prefixes.flush")}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {t("admin.redis.prefixes.protected")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stuck brukere */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Zap size={16} />
            {t("admin.redis.relinkStates.sectionTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.redis.relinkStates.description")}
          </p>
        </div>
        {relinkQuery.isLoading ? (
          <div className="p-4">
            <LoadingSpinner />
          </div>
        ) : !relinkQuery.data || relinkQuery.data.states.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
            {t("admin.redis.relinkStates.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">{t("admin.redis.relinkStates.userId")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.relinkStates.count")}</th>
                  <th className="px-4 py-2 text-left">{t("admin.redis.relinkStates.env")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.relinkStates.age")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.relinkStates.ttl")}</th>
                  <th className="px-4 py-2 text-right">{t("admin.redis.prefixes.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {relinkQuery.data.states.map((s: AdminRedisRelinkStateItem) => (
                  <tr key={s.userId} className="text-slate-800 dark:text-slate-200">
                    <td className="px-4 py-2 font-mono text-xs">{s.userId}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.count ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">{s.env ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.ageSeconds ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.ttlSeconds}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleClearRelink(s.userId)}
                        disabled={clearRelinkMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                      >
                        <Zap size={12} />
                        {t("admin.redis.relinkStates.clear")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function RedisInfoItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-slate-900 dark:text-white";
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`font-mono text-sm font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

// ── Logger-fane (live-tail backend + frontend) ──────────────────────────────

type LogEntry = {
  // Redis Stream-ID (`<ms>-<seq>`) — strengt monotont stigende, brukes som cursor
  id: string;
  timestamp: number;
  source: "backend" | "frontend";
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  msg: string;
  context?: Record<string, unknown>;
};

const LOG_LEVEL_COLOR: Record<LogEntry["level"], string> = {
  fatal: "text-red-700 dark:text-red-300",
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  debug: "text-slate-500 dark:text-slate-400",
  trace: "text-slate-400 dark:text-slate-500",
};

function LoggerFane() {
  const { language, t } = useLanguage();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "backend" | "frontend">("all");
  const [minLevel, setMinLevel] = useState<LogEntry["level"]>("info");
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Aktiver frontend log forwarder når admin åpner logger-fanen
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    void import("@/app/lib/client-logger").then(({ installAdminLogForwarder }) => {
      if (active) {
        cleanup = installAdminLogForwarder();
      }
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  // Polling i stedet for SSE: EventSource kan ikke sende Authorization-header
  // (kun cookies), så Bearer-auth fungerer ikke. Backend lagrer nå loggene i en
  // delt Redis Stream, så polling fra hvilken som helst dyno ser samme data.
  useEffect(() => {
    let cancelled = false;
    let lastId = "";
    // Reset ved filterbytte så vi henter backlog på nytt
    setEntries([]);

    const tick = async () => {
      if (cancelled || pausedRef.current) return;
      try {
        const sp = new URLSearchParams();
        if (sourceFilter !== "all") sp.set("source", sourceFilter);
        sp.set("minLevel", minLevel);
        sp.set("limit", "200");
        if (lastId) sp.set("sinceId", lastId);
        const res = await fetchApi(`/api/admin/logs/recent?${sp.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { entries: LogEntry[] };
        if (cancelled || !data.entries?.length) return;
        // Stream-IDer er sortert; siste element er den nyeste
        lastId = data.entries[data.entries.length - 1].id;
        setEntries((prev) => {
          const next = [...prev, ...data.entries];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      } catch {
        // Ignorer transiente feil — neste polling prøver igjen
      }
    };

    void tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sourceFilter, minLevel]);

  // Auto-scroll til bunnen ved nye rader (kun hvis ikke pauset)
  useEffect(() => {
    if (paused) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, paused]);

  const handleClear = () => setEntries([]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {t("admin.logs.title")}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t("admin.logs.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        >
          <option value="all">{t("admin.logs.sourceAll")}</option>
          <option value="backend">{t("admin.logs.sourceBackend")}</option>
          <option value="frontend">{t("admin.logs.sourceFrontend")}</option>
        </select>
        <select
          value={minLevel}
          onChange={(e) => setMinLevel(e.target.value as LogEntry["level"])}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        >
          <option value="trace">trace+</option>
          <option value="debug">debug+</option>
          <option value="info">info+</option>
          <option value="warn">warn+</option>
          <option value="error">error+</option>
        </select>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? t("admin.logs.resume") : t("admin.logs.pause")}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <X size={14} />
          {t("admin.logs.clear")}
        </button>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {entries.length} / 1000
        </span>
      </div>

      <div
        ref={containerRef}
        className="h-150 overflow-y-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 dark:border-slate-700"
      >
        {entries.length === 0 ? (
          <p className="text-center text-slate-500">{t("admin.logs.empty")}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="border-b border-slate-800/50 py-1 last:border-0">
              <span className="text-slate-500">
                {formaterDatoOgTid(new Date(entry.timestamp), language)}
              </span>{" "}
              <span className={`font-semibold uppercase ${LOG_LEVEL_COLOR[entry.level]}`}>
                {entry.level}
              </span>{" "}
              <span className="text-slate-400">[{entry.source}]</span>{" "}
              <span className="text-slate-100">{entry.msg}</span>
              {entry.context && Object.keys(entry.context).length > 0 && (
                <pre className="ml-12 mt-0.5 text-[10px] text-slate-400">
                  {JSON.stringify(entry.context)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── Innboks-fane (kontaktskjema-meldinger) ──────────────────────────────────

function InnboksFane() {
  const { language, t } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<ContactMessageStatus | "all">("all");
  const [errorIdFilter, setErrorIdFilter] = useState<string>("");
  const [errorIdFilterDraft, setErrorIdFilterDraft] = useState<string>("");
  const [errorIdFilterValidationError, setErrorIdFilterValidationError] = useState<string | null>(
    null,
  );
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading, error } = useAdminContactMessages({
    status: statusFilter,
    errorId: errorIdFilter || undefined,
  });
  const updateStatus = useUpdateContactMessageStatus();
  const deleteMessage = useDeleteContactMessage();
  const replyMessage = useReplyContactMessage();

  const valgt = data?.meldinger.find((m) => m.id === valgtId) ?? null;

  // Auto-marker som lest når en uleste melding blir åpnet.
  // valgt.id er eneste trigger — `valgt` og `updateStatus` er intensjonelt
  // ekskludert fra deps for å unngå å re-kjøre effekten når mutate-funksjonen
  // endrer identitet per render, eller når andre felter på `valgt` endres.
  useEffect(() => {
    if (valgt && valgt.status === "unread") {
      updateStatus.mutate({ id: valgt.id, status: "read" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valgt?.id]);

  const handleSetStatus = (id: string, status: ContactMessageStatus) => {
    updateStatus.mutate(
      { id, status },
      {
        onError: () => showToast.error(t("admin.inbox.updateFailed")),
      },
    );
  };

  const handleReply = (id: string) => {
    if (!replyText.trim()) return;
    replyMessage.mutate(
      { id, melding: replyText.trim() },
      {
        onSuccess: () => {
          showToast.success(t("admin.inbox.replySent"));
          setReplyText("");
          setShowReplyForm(false);
        },
        onError: (err) =>
          showToast.error(
            t("admin.inbox.replyFailed"),
            hentFeilmelding(err, t("admin.inbox.replyFailed")),
          ),
      },
    );
  };

  // Reset svarskjema ved bytte av melding
  useEffect(() => {
    setShowReplyForm(false);
    setReplyText("");
  }, [valgtId]);

  const handleDelete = (m: AdminContactMessage) => {
    visBekreftelsesToast({
      t,
      melding: t("admin.inbox.deleteConfirm"),
      handlingstekst: t("admin.inbox.delete"),
      onBekreft: () => {
        deleteMessage.mutate(m.id, {
          onSuccess: () => {
            showToast.success(t("admin.inbox.deleteSuccess"));
            if (valgtId === m.id) setValgtId(null);
          },
          onError: () => showToast.error(t("admin.inbox.deleteFailed")),
        });
      },
    });
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <FeilMelding melding={t("admin.inbox.loadFailed")} />;

  const meldinger = data?.meldinger ?? [];
  const unread = data?.unread ?? 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("admin.inbox.title")}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t("admin.inbox.unreadCount", { count: String(unread) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Søk etter feil-ID (reportedErrorId eller submit requestId).
              Brukeren har fått en ID fra error boundary eller ved å rapportere feil.
              Admin limer inn ID-en her for å finne matching kontaktmelding. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = errorIdFilterDraft.trim();
              if (trimmed.length === 0) {
                setErrorIdFilter("");
                setErrorIdFilterValidationError(null);
                return;
              }
              if (!isValidReportedErrorId(trimmed)) {
                // Hindre 400 fra backend ved å fange ugyldig input klient-side.
                // Uten denne sjekken faller useQuery i error-state og hele lista
                // forsvinner bak en generisk feilmelding.
                setErrorIdFilterValidationError(t("admin.inbox.errorIdFilterInvalid"));
                return;
              }
              setErrorIdFilterValidationError(null);
              setErrorIdFilter(trimmed);
            }}
            className="flex flex-col items-stretch gap-1"
          >
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={errorIdFilterDraft}
                onChange={(e) => {
                  setErrorIdFilterDraft(e.target.value);
                  if (errorIdFilterValidationError) {
                    setErrorIdFilterValidationError(null);
                  }
                }}
                placeholder={t("admin.inbox.errorIdFilterPlaceholder")}
                aria-invalid={errorIdFilterValidationError ? "true" : undefined}
                aria-describedby={
                  errorIdFilterValidationError ? "admin-inbox-error-id-filter-error" : undefined
                }
                className={`w-48 rounded-lg border bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 ${
                  errorIdFilterValidationError
                    ? "border-red-400 focus:ring-red-500 dark:border-red-700"
                    : "border-slate-200 focus:ring-blue-500 dark:border-slate-700"
                }`}
                aria-label={t("admin.inbox.errorIdFilterAriaLabel")}
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                {t("admin.inbox.errorIdFilterApply")}
              </button>
              {(errorIdFilter || errorIdFilterValidationError) && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorIdFilter("");
                    setErrorIdFilterDraft("");
                    setErrorIdFilterValidationError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t("admin.inbox.errorIdFilterClear")}
                </button>
              )}
            </div>
            {errorIdFilterValidationError && (
              <p
                id="admin-inbox-error-id-filter-error"
                className="text-[11px] text-red-600 dark:text-red-400"
                role="alert"
              >
                {errorIdFilterValidationError}
              </p>
            )}
          </form>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ContactMessageStatus | "all")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="all">{t("admin.inbox.statusAll")}</option>
            <option value="unread">{t("admin.inbox.statusUnread")}</option>
            <option value="read">{t("admin.inbox.statusRead")}</option>
            <option value="replied">{t("admin.inbox.statusReplied")}</option>
          </select>
        </div>
      </div>

      {/* Banner som gjør det tydelig at et feil-ID-filter er aktivt */}
      {errorIdFilter && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-200">
          <span>{t("admin.inbox.errorIdFilterActive")}</span>
          <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800/60">
            {errorIdFilter}
          </code>
          <span className="ml-auto">
            {t("admin.inbox.errorIdFilterMatches", { count: String(meldinger.length) })}
          </span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(280px,1fr)_2fr]">
        {/* Listing */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {meldinger.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t("admin.inbox.empty")}
            </p>
          ) : (
            <ul className="max-h-150 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-700">
              {meldinger.map((m) => {
                const aktiv = valgtId === m.id;
                const erUlest = m.status === "unread";
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setValgtId(m.id)}
                      className={`block w-full px-4 py-3 text-left transition-colors ${
                        aktiv
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : "hover:bg-slate-50 dark:hover:bg-slate-900/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {erUlest && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                        <span
                          className={`truncate text-sm ${
                            erUlest
                              ? "font-semibold text-slate-900 dark:text-white"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {m.navn}
                        </span>
                        {m.status === "replied" && (
                          <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            {t("admin.inbox.statusReplied")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                        {m.emne}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                        {formaterDatoOgTid(m.createdAt, language)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detalj-panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          {!valgt ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("admin.inbox.selectMessage")}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {valgt.emne}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    <strong>{valgt.navn}</strong>{" "}
                    <a
                      href={`mailto:${valgt.epost}?subject=Re: ${encodeURIComponent(valgt.emne)}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      &lt;{valgt.epost}&gt;
                    </a>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formaterDatoOgTid(valgt.createdAt, language)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(valgt)}
                  disabled={deleteMessage.isPending}
                  title={t("admin.inbox.delete")}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Feil-ID-panel: viser reportedErrorId (feilen brukeren rapporterte) og
                  submit-requestId (ID-en for POST /api/kontakt). Admin kan kopiere ID
                  eller filtrere listen på den samme ID-en for å se alle relaterte meldinger. */}
              {(valgt.reportedErrorId || valgt.requestId) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t("admin.inbox.errorCorrelation")}
                  </p>
                  {valgt.reportedErrorId && (
                    <div className="mt-2 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("admin.inbox.reportedErrorIdLabel")}
                        </p>
                        <code className="mt-0.5 block break-all font-mono text-xs text-slate-800 dark:text-slate-200">
                          {valgt.reportedErrorId}
                        </code>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(valgt.reportedErrorId!);
                              showToast.success(t("admin.inbox.errorIdCopied"));
                            } catch {
                              showToast.error(t("admin.inbox.errorIdCopyFailed"));
                            }
                          }}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {t("admin.inbox.copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setErrorIdFilter(valgt.reportedErrorId!);
                            setErrorIdFilterDraft(valgt.reportedErrorId!);
                          }}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] text-blue-700 hover:bg-white dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-800"
                        >
                          {t("admin.inbox.filterByThisId")}
                        </button>
                      </div>
                    </div>
                  )}
                  {valgt.requestId && (
                    <div className="mt-2">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t("admin.inbox.submitRequestIdLabel")}
                      </p>
                      <code className="mt-0.5 block break-all font-mono text-xs text-slate-700 dark:text-slate-300">
                        {valgt.requestId}
                      </code>
                    </div>
                  )}
                  <p className="mt-2 text-[10px] italic text-slate-500 dark:text-slate-400">
                    {t("admin.inbox.errorIdHint")}
                  </p>
                </div>
              )}

              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {valgt.melding}
              </div>

              {valgt.attachmentCount > 0 && valgt.attachmentSummary && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <strong>{t("admin.inbox.attachments")}:</strong>
                  <ul className="mt-1 ml-4 list-disc">
                    {valgt.attachmentSummary.map(
                      (a: { filnavn: string; sizeBytes: number; mimeType: string }, i: number) => (
                        <li key={i}>
                          {a.filnavn} ({Math.round(a.sizeBytes / 1024)} kB)
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}

              {valgt.sideUrl && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("admin.inbox.fromPage")}: <span className="font-mono">{valgt.sideUrl}</span>
                </p>
              )}

              {/* Svarskjema */}
              {showReplyForm && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-900/10">
                  <label
                    htmlFor="reply-text"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t("admin.inbox.replyTo", { name: valgt.navn })}
                  </label>
                  <textarea
                    id="reply-text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={t("admin.inbox.replyPlaceholder")}
                    maxLength={10_000}
                    rows={5}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleReply(valgt.id)}
                      disabled={replyMessage.isPending || !replyText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Send size={12} />
                      {replyMessage.isPending
                        ? t("admin.inbox.replySending")
                        : t("admin.inbox.replySend")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplyForm(false);
                        setReplyText("");
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {t("common.actions.cancel")}
                    </button>
                    <span className="ml-auto text-[10px] text-slate-400">
                      {replyText.length}/10 000
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowReplyForm(!showReplyForm)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Send size={12} />
                  {t("admin.inbox.reply")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSetStatus(valgt.id, "read")}
                  disabled={valgt.status === "read"}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t("admin.inbox.markRead")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSetStatus(valgt.id, "unread")}
                  disabled={valgt.status === "unread"}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t("admin.inbox.markUnread")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSetStatus(valgt.id, "replied")}
                  disabled={valgt.status === "replied"}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {t("admin.inbox.markReplied")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Crawler-vedlikehold ─────────────────────────────────────────────────────

function CrawlerFane() {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminCrawlerStats();
  const retryMutation = useRetryFailedCrawls();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.crawler.error")} />;

  const handleRetry = () => {
    visBekreftelsesToast({
      t,
      melding: t("admin.crawler.retryConfirm"),
      handlingstekst: t("admin.crawler.retryAction"),
      onBekreft: () => {
        retryMutation.mutate(undefined, {
          onSuccess: (r) =>
            showToast.success(
              t("admin.crawler.retrySuccess"),
              t("admin.crawler.retrySummary", {
                reset: String(r.resetItems),
                affected: String(r.affectedUsers),
                caches: String(r.cachesInvalidated),
              }),
            ),
          onError: (e) =>
            showToast.error(
              t("admin.crawler.retryFailed"),
              hentFeilmelding(e, t("admin.crawler.retryFailed")),
            ),
        });
      },
    });
  };

  const kort: StatKortData[] = [
    { label: t("admin.crawler.totalUrls"), verdi: data.totalExternalUrls, ikon: Link2 },
    { label: t("admin.crawler.crawled"), verdi: data.crawledCount, ikon: CheckCircle2 },
    { label: t("admin.crawler.neverCrawled"), verdi: data.neverCrawledCount, ikon: UserX },
    { label: t("admin.crawler.stale"), verdi: data.staleCount, ikon: Clock3 },
    { label: t("admin.crawler.emptyCrawl"), verdi: data.emptyCrawlCount, ikon: AlertTriangle },
    { label: t("admin.crawler.pdfsIndexed"), verdi: data.pdfsIndexed, ikon: FileText },
    { label: t("admin.crawler.subpagesCrawled"), verdi: data.subpagesCrawled, ikon: Globe },
  ];

  const reasonBadge = (reason: "never_crawled" | "stale" | "empty_crawl") => {
    const config = {
      never_crawled: {
        label: t("admin.crawler.reasonNeverCrawled"),
        cls: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400",
      },
      stale: {
        label: t("admin.crawler.reasonStale"),
        cls: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
      },
      empty_crawl: {
        label: t("admin.crawler.reasonEmptyCrawl"),
        cls: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400",
      },
    } as const;
    const c = config[reason];
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}
      >
        {c.label}
      </span>
    );
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("admin.crawler.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("admin.crawler.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kort.map((k) => (
          <StatKort
            key={k.label}
            label={k.label}
            verdi={k.verdi}
            ikon={k.ikon}
            language={language}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {t("admin.crawler.retryTitle")}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.crawler.retryDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retryMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {retryMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {retryMutation.isPending
            ? t("admin.crawler.retryRunning")
            : t("admin.crawler.retryAction")}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("admin.crawler.staleTableTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.crawler.staleTableDescription")}
          </p>
        </div>
        {data.staleItems.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
            {t("admin.crawler.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnReason")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnCourse")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnModule")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnItem")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnUrl")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.crawler.columnLastCrawl")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {data.staleItems.map((item, idx) => (
                  <tr key={`${item.courseId}-${item.externalUrl}-${idx}`}>
                    <td className="px-5 py-3">{reasonBadge(item.reason)}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                      {item.courseName || item.courseId}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {item.moduleTitle}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {item.itemTitle}
                    </td>
                    <td className="px-5 py-3">
                      <a
                        href={item.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <span className="max-w-[280px] truncate">{item.externalUrl}</span>
                        <ExternalLink size={12} className="shrink-0" />
                      </a>
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                      {item.crawledAt
                        ? formaterDatoOgTid(item.crawledAt, language)
                        : t("admin.crawler.never")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Retrieval-debug (query replay) ──────────────────────────────────────────

function RetrievalDebugFane() {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState("");
  const [userId, setUserId] = useState("");
  const mutation = useAdminRetrievalDebug();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    mutation.mutate({
      query: query.trim(),
      ...(courseId.trim() && { courseId: courseId.trim() }),
      ...(userId.trim() && { userId: userId.trim() }),
    });
  };

  const data = mutation.data;

  const renderTable = (rows: AdminRetrievalDebugResponse["vector"]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnRank")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnScore")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnFile")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnModule")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnChunk")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("admin.retrieval.columnPreview")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-3 py-4 text-center text-slate-500 dark:text-slate-400"
              >
                {t("admin.retrieval.noResults")}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.source.fileId}-${r.chunkIndex}-${r.rank}`}>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.rank}</td>
                <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">
                  {r.score.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                  {r.source.fileName}
                </td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                  {r.source.moduleTitle}
                </td>
                <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">
                  {r.chunkIndex}
                </td>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                  <span className="line-clamp-2 max-w-lg">{r.textPreview}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("admin.retrieval.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("admin.retrieval.description")}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("admin.retrieval.queryLabel")}
          </label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.retrieval.queryPlaceholder")}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("admin.retrieval.courseLabel")}
            </label>
            <input
              type="text"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              placeholder={t("admin.retrieval.coursePlaceholder")}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("admin.retrieval.userLabel")}
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t("admin.retrieval.userPlaceholder")}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <button
            type="submit"
            disabled={!query.trim() || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            {mutation.isPending ? t("admin.retrieval.running") : t("admin.retrieval.submit")}
          </button>
        </div>
      </form>

      {mutation.error && (
        <FeilMelding melding={t("admin.retrieval.error")} />
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.retrieval.statsElapsed")}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {data.elapsedMs} ms
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.retrieval.statsConcepts")}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {data.concepts ? data.concepts.join(", ") : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.retrieval.statsDegraded")}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {data.degraded ? t("common.yes") : t("common.no")}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("admin.retrieval.statsReranked")}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {data.sources.reranked ? t("common.yes") : t("common.no")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {[
              { title: t("admin.retrieval.sectionFinal"), rows: data.final },
              { title: t("admin.retrieval.sectionFused"), rows: data.fused },
              { title: t("admin.retrieval.sectionVector"), rows: data.vector },
              { title: t("admin.retrieval.sectionBm25"), rows: data.bm25 },
            ].map((section) => (
              <div
                key={section.title}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {section.title}{" "}
                    <span className="text-slate-400">({section.rows.length})</span>
                  </h3>
                </div>
                {renderTable(section.rows)}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── Ekstraksjons-audit ──────────────────────────────────────────────────────

function ExtractionAuditFane() {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminExtractionAudit();
  const reindexMutation = useReindexMissingFiles();
  const reextractMutation = useReextractTruncatedFiles();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.extraction.error")} />;

  const handleReindex = () => {
    visBekreftelsesToast({
      t,
      melding: t("admin.extraction.reindexConfirm"),
      handlingstekst: t("admin.extraction.reindexAction"),
      onBekreft: () => {
        reindexMutation.mutate(undefined, {
          onSuccess: (r) =>
            showToast.success(
              t("admin.extraction.reindexSuccess"),
              t("admin.extraction.reindexSummary", {
                missing: String(r.missingFiles),
                affected: String(r.affectedUsers),
                caches: String(r.cachesInvalidated),
              }),
            ),
          onError: (e) =>
            showToast.error(
              t("admin.extraction.reindexFailed"),
              hentFeilmelding(e, t("admin.extraction.reindexFailed")),
            ),
        });
      },
    });
  };

  const handleReextract = () => {
    visBekreftelsesToast({
      t,
      melding: t("admin.extraction.reextractConfirm"),
      handlingstekst: t("admin.extraction.reextractAction"),
      onBekreft: () => {
        reextractMutation.mutate(undefined, {
          onSuccess: (r) =>
            showToast.success(
              t("admin.extraction.reextractSuccess"),
              t("admin.extraction.reextractSummary", {
                truncated: String(r.truncatedFiles),
                affected: String(r.affectedUsers),
                caches: String(r.cachesInvalidated),
              }),
            ),
          onError: (e) =>
            showToast.error(
              t("admin.extraction.reextractFailed"),
              hentFeilmelding(e, t("admin.extraction.reextractFailed")),
            ),
        });
      },
    });
  };

  const kort: StatKortData[] = [
    { label: t("admin.extraction.totalFiles"), verdi: data.totalUserFiles, ikon: FileText },
    { label: t("admin.extraction.indexedFiles"), verdi: data.indexedUserFiles, ikon: CheckCircle2 },
    {
      label: t("admin.extraction.truncatedFiles"),
      verdi: data.truncatedFiles.length,
      ikon: AlertTriangle,
    },
    {
      label: t("admin.extraction.unindexedFiles"),
      verdi: data.unindexedUserFiles,
      ikon: AlertTriangle,
    },
  ];

  const reasonLabel = (reason: "no_chunks" | "never_crawled"): string => {
    switch (reason) {
      case "never_crawled":
        return t("admin.extraction.reasonNeverCrawled");
      case "no_chunks":
      default:
        return t("admin.extraction.reasonNoChunks");
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("admin.extraction.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("admin.extraction.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kort.map((k) => (
          <StatKort
            key={k.label}
            label={k.label}
            verdi={k.verdi}
            ikon={k.ikon}
            language={language}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {t("admin.extraction.reindexTitle")}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("admin.extraction.reindexDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleReindex}
          disabled={reindexMutation.isPending || data.unindexedUserFiles === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {reindexMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {reindexMutation.isPending
            ? t("admin.extraction.reindexRunning")
            : t("admin.extraction.reindexAction")}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("admin.extraction.tableTitle")}
          </h3>
        </div>
        {data.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
            {t("admin.extraction.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnOwner")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnCourse")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnModule")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnFile")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnReason")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {data.items.map((item) => (
                  <tr key={`${item.userId}-${item.courseId}-${item.fileId}`}>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                      {item.ownerEmail ?? item.userId}
                    </td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                      {item.courseName || item.courseId}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {item.moduleTitle}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {item.fileName}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        {reasonLabel(item.reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.truncatedFiles.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10">
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 dark:border-amber-800 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-amber-900 dark:text-amber-200">
                {t("admin.extraction.truncatedTableTitle")}
              </h3>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {t("admin.extraction.truncatedDescription", {
                  cap: formaterTall(data.storageCap, language),
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReextract}
              disabled={reextractMutation.isPending}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {reextractMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              {reextractMutation.isPending
                ? t("admin.extraction.reextractRunning")
                : t("admin.extraction.reextractAction")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-100/50 dark:bg-amber-900/20 text-xs uppercase text-amber-900 dark:text-amber-200">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnOwner")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnCourse")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.extraction.columnFile")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("admin.extraction.columnOriginal")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("admin.extraction.columnStored")}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t("admin.extraction.columnLost")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                {data.truncatedFiles.map((item) => (
                  <tr key={`${item.userId}-${item.courseId}-${item.fileId}`}>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                      {item.ownerEmail ?? item.userId}
                    </td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                      {item.courseName || item.courseId}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">
                      {item.fileName}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {formaterTall(item.originalChars, language)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {formaterTall(item.storedChars, language)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-amber-700 dark:text-amber-400">
                      −{formaterTall(item.lostChars, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ── KB-helse ────────────────────────────────────────────────────────────────

function KbHealthFane() {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useAdminKbHealth();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.kbHealth.error")} />;

  const kort: StatKortData[] = [
    { label: t("admin.kbHealth.totalBases"), verdi: data.totalBases, ikon: Library },
    { label: t("admin.kbHealth.emptyBases"), verdi: data.emptyBases, ikon: AlertTriangle },
    { label: t("admin.kbHealth.thinBases"), verdi: data.thinBases, ikon: AlertTriangle },
    { label: t("admin.kbHealth.totalChunks"), verdi: data.totalChunks, ikon: Database },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("admin.kbHealth.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("admin.kbHealth.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kort.map((k) => (
          <StatKort
            key={k.label}
            label={k.label}
            verdi={k.verdi}
            ikon={k.ikon}
            language={language}
          />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("admin.kbHealth.tableTitle")}
          </h3>
        </div>
        {data.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
            {t("admin.kbHealth.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnName")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnOwner")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnChunks")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnLinks")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnFiles")}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t("admin.kbHealth.columnUpdated")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {data.items.map((item) => {
                  const rowClass =
                    item.chunkCount === 0
                      ? "bg-red-50/50 dark:bg-red-900/10"
                      : item.chunkCount < 5
                        ? "bg-amber-50/50 dark:bg-amber-900/10"
                        : "";
                  return (
                    <tr key={item.id} className={rowClass}>
                      <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                        {item.navn}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                        {item.ownerEmail ?? "—"}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {formaterTall(item.chunkCount, language)}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                        {item.linkCount}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                        {item.fileCount}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                        {formaterDatoOgTid(item.updatedAt, language)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Hovedkomponent ──────────────────────────────────────────────────────────

const FANER: {
  id: AdminFane;
  ikon: React.ElementType;
  labelKey:
    | "admin.tabs.stats"
    | "admin.tabs.observability"
    | "admin.tabs.queues"
    | "admin.tabs.redis"
    | "admin.tabs.users"
    | "admin.tabs.inbox"
    | "admin.tabs.audit"
    | "admin.tabs.logs"
    | "admin.tabs.feedback"
    | "admin.tabs.maintenance";
}[] = [
  { id: "stats", ikon: BarChart3, labelKey: "admin.tabs.stats" },
  { id: "observability", ikon: Activity, labelKey: "admin.tabs.observability" },
  { id: "queues", ikon: Layers, labelKey: "admin.tabs.queues" },
  { id: "redis", ikon: Server, labelKey: "admin.tabs.redis" },
  { id: "users", ikon: Users, labelKey: "admin.tabs.users" },
  { id: "inbox", ikon: Mail, labelKey: "admin.tabs.inbox" },
  { id: "audit", ikon: ScrollText, labelKey: "admin.tabs.audit" },
  { id: "logs", ikon: Terminal, labelKey: "admin.tabs.logs" },
  { id: "feedback", ikon: AlertTriangle, labelKey: "admin.tabs.feedback" },
  { id: "maintenance", ikon: Zap, labelKey: "admin.tabs.maintenance" },
];

export function AdminSection() {
  const { t } = useLanguage();
  const [aktivFane, setAdminTab] = useQueryState(
    "adminTab",
    parseAsStringLiteral(GYLDIGE_ADMIN_FANER).withDefault("stats").withOptions({ scroll: false }),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Shield size={20} className="text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{t("admin.title")}</h1>
      </div>

      {/* Faner */}
      <div
        role="tablist"
        aria-label={t("admin.title")}
        className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-1"
      >
        {FANER.map(({ id, ikon: Ikon, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktivFane === id}
            aria-controls={`admin-tabpanel-${id}`}
            id={`admin-tab-${id}`}
            onClick={() => {
              void setAdminTab(id === "stats" ? null : id);
            }}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
              aktivFane === id
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Ikon size={16} className="shrink-0" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Innhold */}
      <div
        role="tabpanel"
        id={`admin-tabpanel-${aktivFane}`}
        aria-labelledby={`admin-tab-${aktivFane}`}
      >
        {aktivFane === "stats" && <StatistikkFane />}
        {aktivFane === "observability" && <ObservabilityFane />}
        {aktivFane === "queues" && <KøerFane />}
        {aktivFane === "redis" && <RedisFane />}
        {aktivFane === "users" && <BrukereFane />}
        {aktivFane === "inbox" && <InnboksFane />}
        {aktivFane === "audit" && <RevisjonsloggFane />}
        {aktivFane === "logs" && <LoggerFane />}
        {aktivFane === "feedback" && <FeedbackFane />}
        {aktivFane === "maintenance" && <MaintenanceFane />}
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Link as LinkIcon,
  FileText,
  Trash2,
  Upload,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import {
  hentKBBase,
  leggTilKBLenke,
  slettKBLenke,
  lastOppKBFil,
  slettKBFil,
  KB_QUERY_KEYS,
} from "@/app/kunnskapsbase/kunnskapsbase-api";
import { formaterDatoShort } from "@/app/lib/dato";
import { KB_MAX_FILE_SIZE_BYTES, KB_MAX_URL_LENGTH } from "common/kunnskapsbase";

interface KbDetaljerProps {
  baseId: string;
  onBack: () => void;
}

/** Formater filstørrelse til lesbar streng */
function formaterStorrelse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FilStatusBadge({
  indexed,
  parseError,
  labels,
}: {
  indexed?: boolean;
  parseError?: string;
  labels: { indexing: string; ready: string; failed: string; errorLabel: string };
}) {
  if (parseError) {
    return (
      <span
        title={`${labels.errorLabel}: ${parseError}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
      >
        <AlertCircle className="h-3 w-3" />
        {labels.failed}
      </span>
    );
  }
  if (indexed === false) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        {labels.indexing}
      </span>
    );
  }
  if (indexed === true) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {labels.ready}
      </span>
    );
  }
  return null;
}

function LenkeStatusBadge({
  status,
  errorText,
  labels,
}: {
  status?: "pending" | "crawling" | "completed" | "failed";
  errorText?: string;
  labels: {
    pending: string;
    crawling: string;
    completed: string;
    failed: string;
    errorLabel: string;
  };
}) {
  if (status === "failed") {
    return (
      <span
        title={errorText ? `${labels.errorLabel}: ${errorText}` : labels.failed}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
      >
        <AlertCircle className="h-3 w-3" />
        {labels.failed}
      </span>
    );
  }
  if (status === "crawling" || status === "pending") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        {status === "crawling" ? labels.crawling : labels.pending}
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {labels.completed}
      </span>
    );
  }
  return null;
}

export function KbDetaljer({ baseId, onBack }: KbDetaljerProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const filInputRef = useRef<HTMLInputElement>(null);

  // Lenke-skjema
  const [visLenkeForm, setVisLenkeForm] = useState(false);
  const [nyUrl, setNyUrl] = useState("");
  const [nyTittel, setNyTittel] = useState("");

  // Bekreftelsesstate for sletting
  const [slettLenkeId, setSlettLenkeId] = useState<string | null>(null);
  const [slettFilId, setSlettFilId] = useState<string | null>(null);

  const { data: base, isLoading, isError, error } = useQuery({
    queryKey: KB_QUERY_KEYS.base(baseId),
    queryFn: () => hentKBBase(baseId),
    staleTime: 1000 * 60,
  });

  // ─── Lenke-mutasjoner ──────────────────────────────────

  const leggTilLenkeMutation = useMutation({
    mutationFn: () => leggTilKBLenke(baseId, nyUrl, nyTittel || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.base(baseId) });
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setNyUrl("");
      setNyTittel("");
      setVisLenkeForm(false);
      showToast.success(t("kb.linkAdded"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.linkAddError"));
    },
  });

  const slettLenkeMutation = useMutation({
    mutationFn: (linkId: string) => slettKBLenke(baseId, linkId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.base(baseId) });
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setSlettLenkeId(null);
      showToast.success(t("kb.linkDeleted"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.linkDeleteError"));
    },
  });

  // ─── Fil-mutasjoner ────────────────────────────────────

  const lastOppFilMutation = useMutation({
    mutationFn: (file: File) => lastOppKBFil(baseId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.base(baseId) });
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      showToast.success(t("kb.fileUploaded"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.fileUploadError"));
    },
  });

  const slettFilMutation = useMutation({
    mutationFn: (fileId: string) => slettKBFil(baseId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.base(baseId) });
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setSlettFilId(null);
      showToast.success(t("kb.fileDeleted"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.fileDeleteError"));
    },
  });

  const håndterLeggTilLenke = useCallback(() => {
    if (!nyUrl.trim()) return;
    leggTilLenkeMutation.mutate();
  }, [nyUrl, leggTilLenkeMutation]);

  const håndterFilValg = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > KB_MAX_FILE_SIZE_BYTES) {
        showToast.error(t("kb.fileTooLarge"));
        return;
      }
      lastOppFilMutation.mutate(file);
      // Nullstill input
      if (filInputRef.current) filInputRef.current.value = "";
    },
    [lastOppFilMutation, t],
  );

  if (isLoading) {
    return <LoadingView text={t("kb.loading")} fullPage={false} />;
  }

  if (isError || !base) {
    return <FeilMelding melding={error?.message || t("kb.loadError")} />;
  }

  return (
    <div className="space-y-6">
      {/* Header med tilbake-knapp */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {base.navn}
        </h2>
      </div>

      {/* KI-tips */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        {t("kb.aiTip", { navn: base.navn })}
      </div>

      {/* ═══ Lenker ═══ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
            <LinkIcon className="h-4 w-4" />
            {t("kb.linksTitle")}
          </h3>
          <button
            type="button"
            onClick={() => setVisLenkeForm(!visLenkeForm)}
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("kb.addLink")}
          </button>
        </div>

        {/* Lenke-skjema */}
        {visLenkeForm && (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="space-y-2">
              <input
                type="url"
                value={nyUrl}
                onChange={(e) => setNyUrl(e.target.value)}
                placeholder={t("kb.urlPlaceholder")}
                maxLength={KB_MAX_URL_LENGTH}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <input
                type="text"
                value={nyTittel}
                onChange={(e) => setNyTittel(e.target.value)}
                placeholder={t("kb.linkTitlePlaceholder")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={håndterLeggTilLenke}
                  disabled={!nyUrl.trim() || leggTilLenkeMutation.isPending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500"
                >
                  {leggTilLenkeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("kb.addLink")
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVisLenkeForm(false);
                    setNyUrl("");
                    setNyTittel("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
                >
                  {t("common.actions.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lenkeliste */}
        {base.lenker.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("kb.noLinks")}</p>
        ) : (
          <div className="space-y-1">
            {base.lenker.map((lenke) => (
              <div
                key={lenke.id}
                className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <a
                      href={lenke.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {lenke.tittel}
                    </a>
                    <LenkeStatusBadge
                      status={lenke.crawlStatus}
                      errorText={lenke.crawlError}
                      labels={{
                        pending: t("kb.statusPending"),
                        crawling: t("kb.statusCrawling"),
                        completed: t("kb.statusReady"),
                        failed: t("kb.statusFailed"),
                        errorLabel: t("kb.crawlErrorLabel"),
                      }}
                    />
                  </div>
                  <p className="mt-0.5 truncate pl-5.5 text-xs text-slate-400">
                    {lenke.url} · {formaterDatoShort(lenke.opprettetDato, language)}
                  </p>
                </div>
                {slettLenkeId === lenke.id ? (
                  <button
                    type="button"
                    onClick={() => slettLenkeMutation.mutate(lenke.id)}
                    disabled={slettLenkeMutation.isPending}
                    className="ml-2 rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                  >
                    {slettLenkeMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t("kb.confirmDelete")
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSlettLenkeId(lenke.id)}
                    className="ml-2 rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ Filer ═══ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
            <FileText className="h-4 w-4" />
            {t("kb.filesTitle")}
          </h3>
          <div>
            <input
              ref={filInputRef}
              type="file"
              onChange={håndterFilValg}
              accept=".pdf,.docx,.doc,.pptx,.txt,.md,.csv"
              className="hidden"
              id="kb-file-upload"
            />
            <label
              htmlFor="kb-file-upload"
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              {lastOppFilMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {t("kb.uploadFile")}
            </label>
          </div>
        </div>

        {/* Filliste */}
        {base.filer.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("kb.noFiles")}</p>
        ) : (
          <div className="space-y-1">
            {base.filer.map((fil) => (
              <div
                key={fil.id}
                className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {fil.filnavn}
                    </p>
                    <FilStatusBadge
                      indexed={fil.indexed}
                      parseError={fil.parseError}
                      labels={{
                        indexing: t("kb.statusIndexing"),
                        ready: t("kb.statusReady"),
                        failed: t("kb.statusFailed"),
                        errorLabel: t("kb.parseErrorLabel"),
                      }}
                    />
                  </div>
                  <p className="mt-0.5 pl-5.5 text-xs text-slate-400">
                    {formaterStorrelse(fil.storrelse)} · {formaterDatoShort(fil.opprettetDato, language)}
                  </p>
                </div>
                {slettFilId === fil.id ? (
                  <button
                    type="button"
                    onClick={() => slettFilMutation.mutate(fil.id)}
                    disabled={slettFilMutation.isPending}
                    className="ml-2 rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                  >
                    {slettFilMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t("kb.confirmDelete")
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSlettFilId(fil.id)}
                    className="ml-2 rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

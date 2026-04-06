/**
 * ChatExportModal – modal for eksport av samtale til ulike formater.
 * Støtter Markdown, PDF, Plain text, Word og Notion.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  FileType,
  Loader2,
  MessageSquare,
  X,
  AlertCircle,
} from "lucide-react";
import { showToast } from "@/app/components/ui/Toaster";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { useLanguage } from "@/app/i18n";
import { fetchApi } from "@/app/lib/apiClient";
import type { ExportTarget, ExportResponse } from "common/export";

interface ExportTargetInfo {
  target: ExportTarget;
  configured: boolean;
}

interface NotionSettingsResponse {
  hasApiKey: boolean;
  defaultPageId: string | null;
}

interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle: string;
  messageCount: number;
  content: string;
}

/** Ikoner for hvert eksportformat */
const FORMAT_ICONS: Record<ExportTarget, React.ReactNode> = {
  markdown: <FileText className="h-5 w-5" />,
  pdf: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-3h8v2H8v-2z" />
    </svg>
  ),
  text: <FileType className="h-5 w-5" />,
  word: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 9l-2 6h-1l-1.5-4.5L7 17H6l-2-6h1.5l1.2 4 1.5-4h1l1.5 4 1.2-4H14zm0-4V3.5L18.5 9H13z" />
    </svg>
  ),
  excel: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-5.5L9.5 17H11l-2-3 2-3H9.5L8 13.5 6.5 11H5l2 3-2 3h1.5L8 14.5z" />
    </svg>
  ),
  notion: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.934zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.454-.233 4.763 7.279V9.107l-1.214-.14c-.094-.514.28-.887.747-.933l3.224-.001zm-12.292-6.63l12.681-.746c1.588-.14 1.962-.047 2.949.7l4.064 2.8c.654.467.888.607.888 1.12v14.371c0 1.12-.42 1.774-1.868 1.867l-15.41.887c-1.073.047-1.587-.093-2.148-.84l-3.267-4.204c-.7-.933-.981-1.633-.981-2.426V3.807c0-.98.42-1.773 1.587-1.913l1.505-.14z" />
    </svg>
  ),
};

/** Rekkefølge for eksportformater i UI */
const FORMAT_ORDER: ExportTarget[] = ["markdown", "pdf", "word", "excel", "text", "notion"];

export function ChatExportModal({
  isOpen,
  onClose,
  chatTitle,
  messageCount,
  content,
}: ChatExportModalProps) {
  const { t } = useLanguage();
  const [selectedTarget, setSelectedTarget] = useState<ExportTarget>("markdown");
  const [availableTargets, setAvailableTargets] = useState<ExportTargetInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notionPageId, setNotionPageId] = useState("");
  const [exportResult, setExportResult] = useState<ExportResponse | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (!isExporting) {
      onClose();
    }
  }, [isExporting, onClose]);

  // Reset state når modal lukkes
  useEffect(() => {
    if (!isOpen) {
      setSelectedTarget("markdown");
      setNotionPageId("");
      setExportResult(null);
    }
  }, [isOpen]);

  // Hent tilgjengelige eksportmål ved åpning
  useEffect(() => {
    if (!isOpen) return;

    async function fetchTargetsAndNotionDefaults() {
      setIsLoading(true);
      try {
        const [targetsResult, notionResult] = await Promise.allSettled([
          fetchApi("/api/ki/export/targets"),
          fetchApi("/api/user/notion", { method: "GET" }),
        ]);

        if (targetsResult.status === "fulfilled" && targetsResult.value.ok) {
          const data = (await targetsResult.value.json()) as { targets: ExportTargetInfo[] };
          setAvailableTargets(data.targets);
        } else {
          // Fallback til lokale mål ved feil på targets-endepunktet
          setAvailableTargets([
            { target: "markdown", configured: true },
            { target: "pdf", configured: true },
            { target: "text", configured: true },
            { target: "word", configured: true },
            { target: "excel", configured: true },
            { target: "notion", configured: false },
          ]);
        }

        if (notionResult.status === "fulfilled" && notionResult.value.ok) {
          const notionData = (await notionResult.value.json()) as NotionSettingsResponse;
          if (notionData.defaultPageId) {
            setNotionPageId(notionData.defaultPageId);
          }
        }
      } finally {
        setIsLoading(false);
      }
    }

    void fetchTargetsAndNotionDefaults();
  }, [isOpen]);

  useDialogAccessibility({
    open: isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: handleClose,
  });

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  const isExternalTarget = selectedTarget === "notion";
  const selectedTargetInfo = availableTargets.find((t) => t.target === selectedTarget);
  const isTargetConfigured = selectedTargetInfo?.configured ?? true;

  const handleExport = useCallback(async () => {
    if (isExternalTarget && !isTargetConfigured) return;

    setIsExporting(true);
    try {
      const options: Record<string, unknown> = {};
      if (selectedTarget === "notion" && notionPageId) {
        options.notion = { parentPageId: notionPageId };
      }

      const response = await fetchApi("/api/ki/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: selectedTarget,
          title: chatTitle || t("exportModal.defaultChatTitle"),
          content,
          metadata: { messageCount, exportedAt: new Date().toISOString() },
          options: Object.keys(options).length > 0 ? options : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          message?: string;
          melding?: string;
          feil?: string;
        };
        throw new Error(
          errorData.melding ||
            errorData.message ||
            errorData.feil ||
            t("exportModal.errorGeneric"),
        );
      }

      const result = (await response.json()) as ExportResponse;
      setExportResult(result);

      if (result.kind === "serialized") {
        // Håndter base64-kodet binærdata (PDF/Word) eller ren tekst (MD/TXT)
        const isBinary = result.data.base64 !== undefined;
        let blob: Blob;

        if (isBinary && result.data.base64) {
          const binaryString = atob(result.data.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: result.data.mimeType });
        } else {
          blob = new Blob([result.data.content], { type: result.data.mimeType });
        }

        const blobUrl = URL.createObjectURL(blob);
        try {
          const a = Object.assign(document.createElement("a"), {
            href: blobUrl,
            download: result.data.filename || `studywise-export.${getFileExtension(selectedTarget)}`,
          });
          a.click();
        } finally {
          URL.revokeObjectURL(blobUrl);
        }

        showToast.success(
          t("exportModal.successDownload", { format: t(`exportModal.formats.${selectedTarget}`) }),
        );
        handleClose();
      } else {
        // Ekstern eksport (Notion) — vis lenke
        showToast.success(t("exportModal.successExternal", { provider: "Notion" }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("exportModal.errorGeneric");
      showToast.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [
    selectedTarget,
    isExternalTarget,
    isTargetConfigured,
    notionPageId,
    chatTitle,
    content,
    messageCount,
    handleClose,
    t,
  ]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-950"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="export-modal-title"
                className="text-xl font-semibold text-slate-900 dark:text-white"
              >
                {t("exportModal.title")}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("exportModal.subtitle")}
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isExporting}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={t("exportModal.closeLabel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 px-6 py-6">
          {/* Samtale-info */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {chatTitle || t("exportModal.defaultChatTitle")}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("exportModal.messageInfo", { messageCount })}
                </p>
              </div>
            </div>
          </div>

          {/* Format-valg */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("exportModal.formatLabel")}
            </label>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-2">
                {FORMAT_ORDER.map((target) => {
                  const targetInfo = availableTargets.find((t) => t.target === target);
                  const configured = targetInfo?.configured ?? target !== "notion";
                  const isExternal = target === "notion";

                  return (
                    <button
                      key={target}
                      type="button"
                      onClick={() => setSelectedTarget(target)}
                      disabled={isExternal && !configured}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                        selectedTarget === target
                          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      } ${isExternal && !configured ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={
                            selectedTarget === target
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-slate-500 dark:text-slate-400"
                          }
                        >
                          {FORMAT_ICONS[target]}
                        </div>
                        <div className="flex-1">
                          <p
                            className={`text-sm font-medium ${
                              selectedTarget === target
                                ? "text-blue-900 dark:text-blue-100"
                                : "text-slate-900 dark:text-white"
                            }`}
                          >
                            {t(`exportModal.formats.${target}`)}
                          </p>
                          <p
                            className={`text-xs ${
                              selectedTarget === target
                                ? "text-blue-700 dark:text-blue-300"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {t(`exportModal.formats.${target}Description`)}
                          </p>
                        </div>
                        {isExternal && !configured && (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notion-spesifikk input */}
          {selectedTarget === "notion" && isTargetConfigured && (
            <div>
              <label
                htmlFor="notion-page-id"
                className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t("exportModal.notionPageIdLabel")}
              </label>
              <input
                id="notion-page-id"
                type="text"
                value={notionPageId}
                onChange={(e) => setNotionPageId(e.target.value)}
                placeholder={t("exportModal.notionPageIdPlaceholder")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t("exportModal.notionPageIdHelp")}
              </p>
            </div>
          )}

          {/* Advarsel for ikke-konfigurert Notion */}
          {isExternalTarget && !isTargetConfigured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/40">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                <div className="space-y-1 text-sm text-amber-900 dark:text-amber-100">
                  <p className="font-medium">
                    {t("exportModal.externalNotConfigured", { provider: "Notion" })}
                  </p>
                  <p>{t("exportModal.externalNotConfiguredHelp")}</p>
                </div>
              </div>
            </div>
          )}

          {/* Ekstern eksport-resultat (Notion) */}
          {exportResult?.kind === "external" && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 dark:border-green-900/60 dark:bg-green-950/40">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-green-900 dark:text-green-100">
                  {t("exportModal.successExternal", { provider: "Notion" })}
                </p>
                {exportResult.data.url && /^https:\/\//.test(exportResult.data.url) && (
                  <a
                    href={exportResult.data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-700 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("exportModal.openInProvider", { provider: "Notion" })}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={handleClose}
            disabled={isExporting}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            {t("exportModal.cancelButton")}
          </button>

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={
              isExporting ||
              isLoading ||
              (isExternalTarget && !isTargetConfigured)
            }
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("exportModal.exportingButton")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {t("exportModal.exportButton")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hjelpefunksjon for å få filendelse basert på target */
function getFileExtension(target: ExportTarget): string {
  switch (target) {
    case "markdown":
      return "md";
    case "pdf":
      return "pdf";
    case "text":
      return "txt";
    case "word":
      return "docx";
    case "excel":
      return "xlsx";
    case "notion":
      return ""; // Notion eksporterer eksternt, ikke som fil
    default:
      return "txt";
  }
}

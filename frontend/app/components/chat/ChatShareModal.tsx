/**
 * ChatShareModal – modal for å opprette delingslenke.
 * Deling er alltid offentlig og utløper automatisk etter 30 dager.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, Link2, MessageSquare, ShieldAlert, X } from "lucide-react";
import { showToast } from "@/app/components/ui/Toaster";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { useLanguage } from "@/app/i18n";

interface ChatShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: () => Promise<{ shareUrl: string } | null>;
  isPending?: boolean;
  chatTitle: string;
  messageCount: number;
}

export function ChatShareModal({
  isOpen,
  onClose,
  onGenerate,
  isPending = false,
  chatTitle,
  messageCount,
}: ChatShareModalProps) {
  const { t } = useLanguage();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (!isPending) {
      onClose();
    }
  }, [isPending, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setShareUrl(null);
    }
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

  const handleGenerate = useCallback(async () => {
    const result = await onGenerate();
    if (result?.shareUrl) {
      setShareUrl(result.shareUrl);
    }
  }, [onGenerate]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast.success(t("shareModal.copiedToast"));
    } catch {
      showToast.error(t("shareModal.copyErrorToast"));
    }
  }, [shareUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6" onClick={handleBackdropClick} role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-modal-title" tabIndex={-1} className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 id="share-modal-title" className="text-xl font-semibold text-slate-900 dark:text-white">
                {t("shareModal.title")}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("shareModal.subtitle")}
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={t("shareModal.closeLabel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {chatTitle || t("shareModal.defaultChatTitle")}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("shareModal.messageInfo", { messageCount })}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
                <p className="font-medium">{t("shareModal.warningTitle")}</p>
                <p>{t("shareModal.warningBody")}</p>
                <p>{t("shareModal.expiryInfo")}</p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-100 px-4 py-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
            <p>{t("shareModal.privacyNotice")}</p>
          </div>

          {shareUrl ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-2 text-sm font-medium text-slate-900 dark:text-white">{t("shareModal.linkLabel")}</p>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  value={shareUrl}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("shareModal.copyButton")}
                  </button>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("shareModal.openButton")}
                  </a>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            {t("shareModal.cancelButton")}
          </button>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isPending}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isPending ? t("shareModal.savingButton") : (shareUrl ? t("shareModal.createNewButton") : t("shareModal.createButton"))}
          </button>
        </div>
      </div>
    </div>
  );
}

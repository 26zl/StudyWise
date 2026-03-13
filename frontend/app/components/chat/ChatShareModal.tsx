/**
 * ChatShareModal – modal for å opprette delingslenke på en chat.
 * Viser varsel om at lenken er offentlig og at alle med lenken kan se innholdet;
 * krever bekreftelse før kall til backend (POST /api/ki/chat/:id/share).
 */
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Link2, MessageSquare, ShieldAlert, X } from "lucide-react";

interface ChatShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
  chatTitle: string;
  messageCount: number;
  expiresInDays?: number;
}

export function ChatShareModal({
  isOpen,
  onClose,
  onConfirm,
  isPending = false,
  chatTitle,
  messageCount,
  expiresInDays = 30,
}: ChatShareModalProps) {
  const [hasConfirmed, setHasConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setHasConfirmed(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPending, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                Del hele chatten
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Offentlig lenke til et snapshot av samtalen slik den ser ut na.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Lukk delingsdialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {chatTitle || "Samtale"}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Denne lenken vil vise hele samtalen med {messageCount} meldinger, inkludert dine egne meldinger og KI-svar.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/40">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
                <p className="font-medium">Del bare hvis du er trygg pa innholdet.</p>
                <p>
                  Alle med lenken kan lese hele chatten. Dette kan inkludere kursnavn, oppgavenavn, filnavn, egne notater og annen tekst du selv har skrevet i chatten.
                </p>
                <p>
                  Lenken utloper automatisk etter {expiresInDays} dager og kan fjernes tidligere fra StudyWise.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={hasConfirmed}
              onChange={(event) => setHasConfirmed(event.target.checked)}
              disabled={isPending}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 dark:border-slate-600"
            />
            <span>
              Jeg forstar at denne delingslenken viser hele samtalen offentlig for alle som har lenken.
            </span>
          </label>

          <div className="flex items-start gap-3 rounded-2xl bg-slate-100 px-4 py-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
            <p>
              StudyWise fjerner ikke automatisk innhold fra chatten ved deling. Ga gjennom samtalen med personvern-briller for du oppretter lenken.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            Avbryt
          </button>

          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={!hasConfirmed || isPending}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isPending ? "Oppretter lenke..." : "Opprett delingslenke"}
          </button>
        </div>
      </div>
    </div>
  );
}

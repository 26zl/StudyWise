"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Database,
  Link,
  FileText,
  Trash2,
  Pencil,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import {
  hentAlleKBBaser,
  opprettKBBase,
  slettKBBase,
  oppdaterKBBase,
  KB_QUERY_KEYS,
} from "@/app/kunnskapsbase/kunnskapsbase-api";
import type { KBBaseSummary } from "common/kunnskapsbase";
import { KB_MAX_BASE_NAME_LENGTH } from "common/kunnskapsbase";
import { formaterDatoShort } from "@/app/lib/dato";

interface KbListeProps {
  onSelectBase: (baseId: string) => void;
}

export function KbListe({ onSelectBase }: KbListeProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [visOpprettForm, setVisOpprettForm] = useState(false);
  const [nyttNavn, setNyttNavn] = useState("");
  const [redigerBaseId, setRedigerBaseId] = useState<string | null>(null);
  const [redigerNavn, setRedigerNavn] = useState("");
  const [slettBekrefter, setSlettBekrefter] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: KB_QUERY_KEYS.bases,
    queryFn: hentAlleKBBaser,
    staleTime: 1000 * 60 * 2,
  });

  const opprettMutation = useMutation({
    mutationFn: (navn: string) => opprettKBBase(navn),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setNyttNavn("");
      setVisOpprettForm(false);
      showToast.success(t("kb.baseCreated"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.createError"));
    },
  });

  const slettMutation = useMutation({
    mutationFn: (id: string) => slettKBBase(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setSlettBekrefter(null);
      showToast.success(t("kb.baseDeleted"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.deleteError"));
    },
  });

  const oppdaterMutation = useMutation({
    mutationFn: ({ id, navn }: { id: string; navn: string }) => oppdaterKBBase(id, navn),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_QUERY_KEYS.bases });
      setRedigerBaseId(null);
      showToast.success(t("kb.baseUpdated"));
    },
    onError: (err: Error) => {
      showToast.error(err.message || t("kb.updateError"));
    },
  });

  const håndterOpprett = useCallback(() => {
    const trimmed = nyttNavn.trim();
    if (!trimmed) return;
    opprettMutation.mutate(trimmed);
  }, [nyttNavn, opprettMutation]);

  const håndterOppdater = useCallback(() => {
    if (!redigerBaseId) return;
    const trimmed = redigerNavn.trim();
    if (!trimmed) return;
    oppdaterMutation.mutate({ id: redigerBaseId, navn: trimmed });
  }, [redigerBaseId, redigerNavn, oppdaterMutation]);

  if (isLoading) {
    return <LoadingView text={t("kb.loading")} fullPage={false} />;
  }

  if (isError) {
    return <FeilMelding melding={error?.message || t("kb.loadError")} />;
  }

  const baser = data?.baser ?? [];

  return (
    <div className="space-y-4">
      {/* Header med opprett-knapp */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t("kb.basesTitle")}
        </h2>
        <button
          type="button"
          onClick={() => setVisOpprettForm(!visOpprettForm)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          {t("kb.createBase")}
        </button>
      </div>

      {/* Opprett-skjema */}
      {visOpprettForm && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
          <label htmlFor="kb-new-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("kb.baseName")}
          </label>
          <div className="flex gap-2">
            <input
              id="kb-new-name"
              type="text"
              value={nyttNavn}
              onChange={(e) => setNyttNavn(e.target.value)}
              placeholder={t("kb.baseNamePlaceholder")}
              maxLength={KB_MAX_BASE_NAME_LENGTH}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              onKeyDown={(e) => { if (e.key === "Enter") håndterOpprett(); }}
            />
            <button
              type="button"
              onClick={håndterOpprett}
              disabled={!nyttNavn.trim() || opprettMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {opprettMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.actions.save")}
            </button>
            <button
              type="button"
              onClick={() => { setVisOpprettForm(false); setNyttNavn(""); }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            >
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Tom tilstand */}
      {baser.length === 0 && !visOpprettForm && (
        <FeilMelding melding={t("kb.noBases")} type="info" />
      )}

      {/* Liste over baser */}
      <div className="space-y-2">
        {baser.map((base: KBBaseSummary) => (
          <div
            key={base.id}
            className="group rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-blue-600"
          >
            {redigerBaseId === base.id ? (
              /* Redigerings-modus */
              <div className="flex gap-2">
                <input
                  type="text"
                  value={redigerNavn}
                  onChange={(e) => setRedigerNavn(e.target.value)}
                  maxLength={KB_MAX_BASE_NAME_LENGTH}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  onKeyDown={(e) => { if (e.key === "Enter") håndterOppdater(); }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={håndterOppdater}
                  disabled={!redigerNavn.trim() || oppdaterMutation.isPending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500"
                >
                  {t("common.actions.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setRedigerBaseId(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
                >
                  {t("common.actions.cancel")}
                </button>
              </div>
            ) : (
              /* Normal visning */
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onSelectBase(base.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <Database className="h-5 w-5 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {base.navn}
                    </p>
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Link className="h-3 w-3" />
                        {base.antallLenker} {t("kb.links")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {base.antallFiler} {t("kb.files")}
                      </span>
                      <span>{formaterDatoShort(base.opprettetDato, language)}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500" />
                </button>

                {/* Handlingsknapper */}
                <div className="ml-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRedigerBaseId(base.id);
                      setRedigerNavn(base.navn);
                    }}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    title={t("kb.editBase")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {slettBekrefter === base.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        slettMutation.mutate(base.id);
                      }}
                      disabled={slettMutation.isPending}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                    >
                      {slettMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("kb.confirmDelete")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlettBekrefter(base.id);
                      }}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      title={t("kb.deleteBase")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

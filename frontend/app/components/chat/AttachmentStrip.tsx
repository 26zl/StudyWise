/*
 * AttachmentStrip – kompakt horisontal vedleggsliste
 * Viser bilder som thumbnails og dokumenter som chips.
 * Brukes rett over input-feltet i ChatSection.
 */
"use client";

import { useEffect, useState } from "react";
import { X, FileText, FileSpreadsheet, Presentation } from "lucide-react";
import { useLanguage } from "@/app/i18n";

// Typer

interface AttachmentStripProps {
  vedlegg: File[];
  onFjern: (index: number) => void;
}

// Hjelpere

/** Sjekk om fil er et bilde basert på MIME-type */
function erBilde(fil: File): boolean {
  return fil.type.startsWith("image/");
}

/** Velg ikon basert på filtype */
function dokumentIkon(fil: File) {
  const ext = fil.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "xlsx" || ext === "xls") {
    return <FileSpreadsheet className="w-4 h-4 shrink-0" />;
  }
  if (ext === "pptx" || ext === "ppt") {
    return <Presentation className="w-4 h-4 shrink-0" />;
  }
  // PDF, DOCX, TXT, MD, etc.
  return <FileText className="w-4 h-4 shrink-0" />;
}

/** Kort filnavn – kutt ned til maks tegn */
function kortFilnavn(navn: string, maks = 24): string {
  if (navn.length <= maks) return navn;
  const ext = navn.lastIndexOf(".");
  if (ext === -1) return `${navn.slice(0, maks - 1)}…`;
  const etternavn = navn.slice(ext);
  const stamme = navn.slice(0, maks - etternavn.length - 1);
  return `${stamme}…${etternavn}`;
}

/** Formater filstørrelse til lesbar tekst */
function formatStørrelse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Bildechip med blob-URL lifecycle

function BildeThumbnail({ fil, onFjern }: { fil: File; onFjern: () => void }) {
  const { t } = useLanguage();
  // useState + useEffect i stedet for useMemo — unngår at StrictMode revoke-r URL-en
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(fil);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [fil]);

  return (
    <div className="group relative flex items-center gap-2 h-14 pl-1.5 pr-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 max-w-48">
      {/* Liten thumbnail */}
      <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
        {url && <img src={url} alt={fil.name} className="h-full w-full object-cover" />}
      </div>
      {/* Filinfo */}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
          {kortFilnavn(fil.name)}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {formatStørrelse(fil.size)}
        </span>
      </div>
      {/* Fjern-knapp */}
      <button
        type="button"
        onClick={onFjern}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-600 dark:bg-slate-400 text-white dark:text-slate-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t("chat.removeAttachment", { name: fil.name })}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// DokumentChip

function DokumentChip({ fil, onFjern }: { fil: File; onFjern: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="group flex items-center gap-1.5 h-14 pl-1.5 pr-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0 max-w-56 relative">
      <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
        {dokumentIkon(fil)}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
          {kortFilnavn(fil.name)}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {formatStørrelse(fil.size)}
        </span>
      </div>
      <button
        type="button"
        onClick={onFjern}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-600 dark:bg-slate-400 text-white dark:text-slate-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t("chat.removeAttachment", { name: fil.name })}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Hoved-komponent

export function AttachmentStrip({ vedlegg, onFjern }: AttachmentStripProps) {
  if (vedlegg.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1 py-1">
      {vedlegg.map((fil, index) =>
        erBilde(fil) ? (
          <BildeThumbnail
            key={`${fil.name}-${fil.size}-${index}`}
            fil={fil}
            onFjern={() => onFjern(index)}
          />
        ) : (
          <DokumentChip
            key={`${fil.name}-${fil.size}-${index}`}
            fil={fil}
            onFjern={() => onFjern(index)}
          />
        ),
      )}
    </div>
  );
}

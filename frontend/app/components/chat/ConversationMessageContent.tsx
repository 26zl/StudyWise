"use client";

import { memo, useDeferredValue } from "react";
import { FileText, Image, BookOpen, Calendar, Folder, Sparkles, Layers } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { contentRendererComponents } from "@/app/components/ui/ContentRenderer";
import {
  erBildefil,
  hentSamtaleinnhold,
  type ConversationDisplayMessage,
} from "@/app/components/chat/conversationMessageUtils";
import { useLanguage } from "@/app/i18n";
import type { SvarKilde } from "common/ki";

// Utvid sanitize-schema for å tillate KaTeX-genererte elementer (math, annotation, semantics, etc.)
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "math",
    "annotation",
    "semantics",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "mover",
    "munder",
    "msqrt",
    "mroot",
    "mtable",
    "mtr",
    "mtd",
    "mtext",
    "mspace",
    "mpadded",
    "menclose",
    "mstyle",
    "msubsup",
    "mmultiscripts",
    "mprescripts",
  ],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ["className", /^(math|katex|callout)/]],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      [
        "className",
        /^(katex|mord|mbin|mrel|mopen|mclose|mpunct|minner|mop|mfrac|msqrt|vlist|strut|frac-line|overline|underline|accent|base|sup|sub|delimsizing|nulldelimiter|sizing|reset-size|fontsize|text|math)/,
      ],
      // KaTeX trenger inline style for matematisk posisjonering/størrelse. Vi
      // begrenser til et konservativt sett av CSS-egenskaper for å forhindre
      // CSS-injeksjon (f.eks. position:fixed + z-index som kaprer UI).
      // KaTeX genererer typisk flere deklarasjoner per style (f.eks.
      // "height:0.84em;vertical-align:-0.14em;") — regexen tillater derfor
      // gjentatte property:value-par separert med ';'. Hvert par valideres
      // mot whitelisten, så én ikke-tillatt property gjør hele style ugyldig
      // og sanitizeren dropper den. Regexen er deterministisk: hver iterasjon
      // MÅ avsluttes med ';' eller strengslutt, property-navn er anchored
      // alternation, og value-delen er et enkelt character class uten
      // nested repetisjon. Derfor ingen ReDoS-risiko.
      [
        "style",
        // eslint-disable-next-line security/detect-unsafe-regex -- deterministisk; se kommentar over
        /^(?:(?:color|background-color|font-size|font-weight|font-style|text-decoration|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|vertical-align|line-height|display|white-space|border-top|border-bottom|border-right|border-left|border-top-width|border-color)\s*:\s*[a-z0-9#.%\s,()-]+\s*(?:;\s*|$))+$/i,
      ],
      "aria-hidden",
    ],
    math: ["xmlns", "display"],
    annotation: ["encoding"],
    section: [["className", /^footnotes/], "dataFootnotes"],
  },
};

/**
 * Fjerner interne wrapper-tagger (<svar>, </svar>, <answer>, ...) som
 * AI-modellen bruker internt. Disse skal aldri synes for brukeren.
 *
 * Spesialhåndterer <svarkilde>...</svarkilde>: hele blokken (inkludert verdien)
 * fjernes — ellers ville en eldre, lagret melding med ren regex-stripping vist
 * "generell" som tilfeldig ord midt i teksten.
 */
function stripInternalTags(text: string): string {
  return text
    .replace(/<svarkilde>[\s\S]*?<\/svarkilde>/gi, "")
    .replace(/<\/?[a-z_][a-z0-9_-]*>/gi, "")
    .trim();
}

type SvarKildeBadgeProps = {
  svarKilde: SvarKilde;
};

/**
 * Badge som vises over assistent-svar for å gjøre kilden tydelig.
 * "generell" får sterkest visuell vekt — det er signalet om at svaret
 * IKKE er forankret i studentens egen pensum/Canvas.
 */
function SvarKildeBadge({ svarKilde }: SvarKildeBadgeProps) {
  const { t } = useLanguage();
  const config: Record<
    SvarKilde,
    { label: string; tooltip: string; klasse: string; Icon: typeof BookOpen }
  > = {
    kursmateriale: {
      label: t("chat.svarKilde.kursmateriale.label"),
      tooltip: t("chat.svarKilde.kursmateriale.tooltip"),
      klasse:
        "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
      Icon: BookOpen,
    },
    canvas: {
      label: t("chat.svarKilde.canvas.label"),
      tooltip: t("chat.svarKilde.canvas.tooltip"),
      klasse:
        "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
      Icon: Calendar,
    },
    kunnskapsbase: {
      label: t("chat.svarKilde.kunnskapsbase.label"),
      tooltip: t("chat.svarKilde.kunnskapsbase.tooltip"),
      klasse:
        "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900",
      Icon: Folder,
    },
    blandet: {
      label: t("chat.svarKilde.blandet.label"),
      tooltip: t("chat.svarKilde.blandet.tooltip"),
      klasse:
        "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
      Icon: Layers,
    },
    generell: {
      label: t("chat.svarKilde.generell.label"),
      tooltip: t("chat.svarKilde.generell.tooltip"),
      klasse:
        "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800",
      Icon: Sparkles,
    },
  };

  const { label, tooltip, klasse, Icon } = config[svarKilde];

  return (
    <div
      className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${klasse}`}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </div>
  );
}

function AssistantMarkdown({ innhold, svarKilde }: { innhold: string; svarKilde?: SvarKilde }) {
  // useDeferredValue lar React hoppe over mellomliggende render-stadier under
  // rask streaming — markdown-parsingen (remark+rehype+KaTeX+sanitize) er
  // tung, så deferred rendering holder UI-tråden responsiv.
  const deferred = useDeferredValue(stripInternalTags(innhold));
  return (
    <div>
      {svarKilde ? <SvarKildeBadge svarKilde={svarKilde} /> : null}
      <div className="prose prose-base max-w-none prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeSanitize, sanitizeSchema]]}
          components={contentRendererComponents}
        >
          {deferred}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function ConversationMessageContentImpl({ message }: { message: ConversationDisplayMessage }) {
  if (message.rolle === "assistant") {
    return <AssistantMarkdown innhold={message.innhold} svarKilde={message.svarKilde} />;
  }

  const { tekst, filer } = hentSamtaleinnhold(message);

  return (
    <>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{tekst}</p>
      {filer.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {filer.map((navn, index) => (
            <span
              key={`${navn}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-600/50 dark:text-slate-300"
            >
              {erBildefil(navn) ? (
                <Image aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <FileText aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
              )}
              {navn}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function vedleggLiktArray(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Memoiser så ferdige meldinger ikke re-parser markdown når den streamende
// meldingen oppdateres. Comparator sjekker rolle + innhold + vedlegg + svarKilde
// slik at oppdateringer på samme melding fortsatt trigger re-render.
export const ConversationMessageContent = memo(
  ConversationMessageContentImpl,
  (prev, next) =>
    prev.message.rolle === next.message.rolle &&
    prev.message.innhold === next.message.innhold &&
    prev.message.svarKilde === next.message.svarKilde &&
    vedleggLiktArray(prev.message.vedleggNavn, next.message.vedleggNavn),
);

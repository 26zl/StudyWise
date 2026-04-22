"use client";

import { memo, useDeferredValue } from "react";
import { FileText, Image } from "lucide-react";
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
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", /^(math|katex|callout)/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^(katex|mord|mbin|mrel|mopen|mclose|mpunct|minner|mop|mfrac|msqrt|vlist|strut|frac-line|overline|underline|accent|base|sup|sub|delimsizing|nulldelimiter|sizing|reset-size|fontsize|text|math)/],
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
      // eslint-disable-next-line security/detect-unsafe-regex -- deterministisk; se kommentar over
      ["style", /^(?:(?:color|background-color|font-size|font-weight|font-style|text-decoration|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|vertical-align|line-height|display|white-space|border-top|border-bottom|border-right|border-left|border-top-width|border-color)\s*:\s*[a-z0-9#.%\s,()-]+\s*(?:;\s*|$))+$/i],
      "aria-hidden",
    ],
    math: ["xmlns", "display"],
    annotation: ["encoding"],
    section: [["className", /^footnotes/], "dataFootnotes"],
  },
};


function AssistantMarkdown({ innhold }: { innhold: string }) {
  // useDeferredValue lar React hoppe over mellomliggende render-stadier under
  // rask streaming — markdown-parsingen (remark+rehype+KaTeX+sanitize) er
  // tung, så deferred rendering holder UI-tråden responsiv.
  const deferred = useDeferredValue(innhold);
  return (
    <div className="prose prose-base max-w-none prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeSanitize, sanitizeSchema]]}
        components={contentRendererComponents}
      >
        {deferred}
      </ReactMarkdown>
    </div>
  );
}

function ConversationMessageContentImpl({
  message,
}: {
  message: ConversationDisplayMessage;
}) {
  if (message.rolle === "assistant") {
    return <AssistantMarkdown innhold={message.innhold} />;
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
// meldingen oppdateres. Comparator sjekker rolle + innhold + vedlegg slik at
// oppdateringer på samme melding fortsatt trigger re-render.
export const ConversationMessageContent = memo(
  ConversationMessageContentImpl,
  (prev, next) =>
    prev.message.rolle === next.message.rolle
    && prev.message.innhold === next.message.innhold
    && vedleggLiktArray(prev.message.vedleggNavn, next.message.vedleggNavn),
);

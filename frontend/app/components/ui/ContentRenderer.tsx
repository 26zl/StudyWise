"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Check, Copy, Download } from "lucide-react";
// highlight.js/lib/common inkluderer ~35 vanlige programmeringsspråk (JS/TS,
// Python, Java, C#, C/C++, Go, Rust, SQL, HTML/CSS, Bash, JSON, YAML, osv.)
// i stedet for full-bundle (~600 kB) som laster alle 190+ språk. hljs.highlight()
// og hljs.highlightAuto() er API-kompatible; sistnevnte gjetter kun mellom de
// registrerte språkene i common — dekning er mer enn nok for student-kode.
import hljs from "highlight.js/lib/common";
import DOMPurify from "isomorphic-dompurify";
import { useLanguage } from "@/app/i18n";
import type { Components } from "react-markdown";

// ─── Kodeblokk ────────────────────────────────────────────────────────────────

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * Kodeblokk med syntax-highlighting (highlight.js) og kopier-knapp.
 * Brukes som `components.code` i ReactMarkdown.
 * Bruker hljs.highlight() + dangerouslySetInnerHTML slik at fargene overlever React re-render.
 */
function CodeBlock({ className, children }: CodeBlockProps) {
  const { t } = useLanguage();
  const [kopiert, setKopiert] = useState(false);
  const kopiertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (kopiertTimerRef.current) clearTimeout(kopiertTimerRef.current);
    };
  }, []);

  // Detekter språk fra markdown className ("language-java" → "java", "language-shell-session" → "shell-session")
  const match = className?.match(/language-([\w-]+)/);
  const sprak = match?.[1];
  // Blokkmodus: har språk ELLER inneholder newlines (fenced code uten språk)
  const erBlokk = !!sprak || (typeof children === "string" && children.includes("\n"));
  const kodeTekst = String(children).replace(/\n$/, "");

  // Highlight til HTML én gang per innhold — sanitert med DOMPurify for å hindre XSS.
  // MÅ kalles før eventuell tidlig retur (rules-of-hooks); vi bruker kun resultatet
  // i blokkmodus, men hooken må kalles likt hver render.
  const highlightedHtml = useMemo(() => {
    try {
      const result = sprak
        ? hljs.highlight(kodeTekst, { language: sprak, ignoreIllegals: true })
        : hljs.highlightAuto(kodeTekst);
      return DOMPurify.sanitize(result.value, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] });
    } catch {
      return escapeHtml(kodeTekst);
    }
  }, [kodeTekst, sprak]);

  // Inline code — render som vanlig <code>
  if (!erBlokk) {
    return (
      <code className="text-blue-600 dark:text-blue-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-sm">
        {children}
      </code>
    );
  }

  async function kopierKode() {
    try {
      await navigator.clipboard.writeText(kodeTekst);
      setKopiert(true);
      if (kopiertTimerRef.current) clearTimeout(kopiertTimerRef.current);
      kopiertTimerRef.current = setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Clipboard API utilgjengelig (f.eks. http, iframe, manglende permissions)
    }
  }

  const sprakLabel = sprak?.toUpperCase() ?? "";

  return (
    <div className="relative my-3 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header med språk-label og kopier-knapp */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400 dark:bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-400 dark:bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-400 dark:bg-green-500" />
          </div>
          <span aria-hidden="true" className="text-xs font-medium text-slate-600 dark:text-slate-300 ml-1 uppercase tracking-wide">
            {sprakLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={kopierKode}
          className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
          title={t("codeBlock.copyTitle")}
          aria-label={t("codeBlock.copyTitle")}
        >
          {kopiert ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>{t("codeBlock.copiedLabel")}</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>{t("codeBlock.copyLabel")}</span>
            </>
          )}
        </button>
      </div>

      {/* Kodeinnhold — hljs-klassen sikrer at globals.css .hljs / .hljs-keyword etc. gjelder */}
      <div className="overflow-x-auto bg-white dark:bg-slate-900">
        <pre className="m-0! p-4! bg-transparent!">
          <code
            className={`hljs language-${sprak ?? "plaintext"} bg-transparent! text-sm leading-relaxed block`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>

      {/* Linje-teller footer */}
      <div className="flex justify-end px-4 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {t("codeBlock.linesLabel", { count: kodeTekst.split("\n").length })}
        </span>
      </div>
    </div>
  );
}

// ─── Tabell ───────────────────────────────────────────────────────────────────

function MarkdownTable({ children, ...props }: React.ComponentProps<"table">) {
  const { t } = useLanguage();
  const tableRef = useRef<HTMLTableElement>(null);

  const exportToCSV = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;

    const rows = Array.from(table.querySelectorAll("tr"));
    const csvContent = rows
      .map((row) =>
        Array.from(row.querySelectorAll("th, td"))
          .map((cell) => {
            const text = (cell as HTMLElement).innerText.replace(/"/g, '""');
            return `"${text}"`;
          })
          .join("\t"),
      )
      .join("\n");

    // BOM for riktig norsk tegnsett i Excel
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `tabell-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="my-3 rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="overflow-x-auto">
        <table
          ref={tableRef}
          className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700"
          {...props}
        >
          {children}
        </table>
      </div>
      <div className="flex justify-end px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={exportToCSV}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
          title={t("table.exportCSV")}
          aria-label={t("table.exportCSV")}
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t("table.exportCSV")}</span>
        </button>
      </div>
    </div>
  );
}

function MarkdownThead({ children, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead className="bg-slate-50 dark:bg-slate-800/70" {...props}>
      {children}
    </thead>
  );
}

function MarkdownTh({ children, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
      {...props}
    >
      {children}
    </th>
  );
}

function MarkdownTr({ children, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className="border-b border-slate-100 last:border-b-0 dark:border-slate-700/50 even:bg-slate-50/50 dark:even:bg-slate-800/30"
      {...props}
    >
      {children}
    </tr>
  );
}

function MarkdownTd({ children, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className="px-4 py-2.5 text-slate-700 dark:text-slate-300 whitespace-normal"
      {...props}
    >
      {children}
    </td>
  );
}

// ─── Blockquote / Callout ─────────────────────────────────────────────────────

// Gjenkjenner callout-prefixer: "> **Definisjon:**", "> **NB:**", "> **Eksempel:**" osv.
const CALLOUT_PATTERNS: Record<string, { border: string; bg: string; darkBorder: string; darkBg: string }> = {
  definisjon: { border: "border-blue-400", bg: "bg-blue-50", darkBorder: "dark:border-blue-500", darkBg: "dark:bg-blue-950/30" },
  definition: { border: "border-blue-400", bg: "bg-blue-50", darkBorder: "dark:border-blue-500", darkBg: "dark:bg-blue-950/30" },
  eksempel:   { border: "border-green-400", bg: "bg-green-50", darkBorder: "dark:border-green-500", darkBg: "dark:bg-green-950/30" },
  example:    { border: "border-green-400", bg: "bg-green-50", darkBorder: "dark:border-green-500", darkBg: "dark:bg-green-950/30" },
  nb:         { border: "border-amber-400", bg: "bg-amber-50", darkBorder: "dark:border-amber-500", darkBg: "dark:bg-amber-950/30" },
  note:       { border: "border-amber-400", bg: "bg-amber-50", darkBorder: "dark:border-amber-500", darkBg: "dark:bg-amber-950/30" },
  merk:       { border: "border-amber-400", bg: "bg-amber-50", darkBorder: "dark:border-amber-500", darkBg: "dark:bg-amber-950/30" },
  viktig:     { border: "border-red-400", bg: "bg-red-50", darkBorder: "dark:border-red-500", darkBg: "dark:bg-red-950/30" },
  important:  { border: "border-red-400", bg: "bg-red-50", darkBorder: "dark:border-red-500", darkBg: "dark:bg-red-950/30" },
  advarsel:   { border: "border-red-400", bg: "bg-red-50", darkBorder: "dark:border-red-500", darkBg: "dark:bg-red-950/30" },
  warning:    { border: "border-red-400", bg: "bg-red-50", darkBorder: "dark:border-red-500", darkBg: "dark:bg-red-950/30" },
  tips:       { border: "border-purple-400", bg: "bg-purple-50", darkBorder: "dark:border-purple-500", darkBg: "dark:bg-purple-950/30" },
  tip:        { border: "border-purple-400", bg: "bg-purple-50", darkBorder: "dark:border-purple-500", darkBg: "dark:bg-purple-950/30" },
  hint:       { border: "border-purple-400", bg: "bg-purple-50", darkBorder: "dark:border-purple-500", darkBg: "dark:bg-purple-950/30" },
};

function extractCalloutType(children: React.ReactNode): string | null {
  const text = extractTextContent(children);
  const match = text.match(/^\*{0,2}(\w+):?\*{0,2}\s/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractTextContent((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

function MarkdownBlockquote({ children, ...props }: React.ComponentProps<"blockquote">) {
  const calloutKey = extractCalloutType(children);
  const style = calloutKey ? CALLOUT_PATTERNS[calloutKey] : null;

  if (style) {
    return (
      <blockquote
        className={`my-3 border-l-4 ${style.border} ${style.darkBorder} ${style.bg} ${style.darkBg} rounded-r-lg px-4 py-3 not-italic`}
        {...props}
      >
        {children}
      </blockquote>
    );
  }

  return (
    <blockquote
      className="my-3 border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 rounded-r-lg px-4 py-3 not-italic"
      {...props}
    >
      {children}
    </blockquote>
  );
}

// ─── Fotnoter ─────────────────────────────────────────────────────────────────

function MarkdownSection({ children, ...props }: React.ComponentProps<"section">) {
  const isFootnotes =
    props.className?.includes("footnotes") ||
    (props as Record<string, unknown>)["data-footnotes"] !== undefined;

  if (isFootnotes) {
    return (
      <section
        className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
        {...props}
      >
        {children}
      </section>
    );
  }

  return <section {...props}>{children}</section>;
}

// ─── Eksportert components-objekt for ReactMarkdown ───────────────────────────

/**
 * Felles markdown-komponent-overstyringer for ReactMarkdown.
 * Generalisert for alle studieretninger — håndterer kode, tabeller,
 * matematikk (via KaTeX plugin), callout-bokser og fotnoter.
 */
export const contentRendererComponents: Components = {
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  table: MarkdownTable,
  thead: MarkdownThead,
  th: MarkdownTh,
  tr: MarkdownTr,
  td: MarkdownTd,
  blockquote: MarkdownBlockquote,
  section: MarkdownSection,
};

// ─── Hjelpefunksjon ───────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

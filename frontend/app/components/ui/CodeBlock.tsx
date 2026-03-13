"use client";

import { useState, useMemo } from "react";
import { Check, Copy } from "lucide-react";
import hljs from "highlight.js";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * Kodeblokk med syntax-highlighting (highlight.js) og kopier-knapp.
 * Brukes som `components.code` i ReactMarkdown.
 * Bruker hljs.highlight() + dangerouslySetInnerHTML slik at fargene overlever React re-render.
 */
export function CodeBlock({ className, children }: CodeBlockProps) {
  const [kopiert, setKopiert] = useState(false);

  // Detekter språk fra markdown className ("language-java" → "java")
  const match = className?.match(/language-(\w+)/);
  const sprak = match?.[1];
  const erBlokk = !!sprak;

  // Inline code — render som vanlig <code>
  if (!erBlokk) {
    return (
      <code className="text-blue-600 dark:text-blue-400 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-sm">
        {children}
      </code>
    );
  }

  const kodeTekst = String(children).replace(/\n$/, "");

  // Highlight til HTML én gang per innhold — overlever re-render fordi React eier HTML-en
  const highlightedHtml = useMemo(() => {
    try {
      const result = sprak
        ? hljs.highlight(kodeTekst, { language: sprak, ignoreIllegals: true })
        : hljs.highlightAuto(kodeTekst);
      return result.value;
    } catch {
      return escapeHtml(kodeTekst);
    }
  }, [kodeTekst, sprak]);

  async function kopierKode() {
    try {
      await navigator.clipboard.writeText(kodeTekst);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
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
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-1 uppercase tracking-wide">
            {sprakLabel}
          </span>
        </div>
        <button
          onClick={kopierKode}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
          title="Kopier kode"
        >
          {kopiert ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Kopiert</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Kopier</span>
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
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {kodeTekst.split("\n").length} linjer
        </span>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

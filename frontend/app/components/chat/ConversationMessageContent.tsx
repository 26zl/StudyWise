"use client";

import { FileText, Image } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/app/components/ui/CodeBlock";
import {
  erBildefil,
  hentSamtaleinnhold,
  type ConversationDisplayMessage,
} from "@/app/components/chat/conversationMessageUtils";

const markdownKomponenter: Components = {
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
};

export function ConversationMessageContent({
  message,
}: {
  message: ConversationDisplayMessage;
}) {
  if (message.rolle === "assistant") {
    return (
      <div className="prose prose-base max-w-none prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={markdownKomponenter}
        >
          {message.innhold}
        </ReactMarkdown>
      </div>
    );
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
                <Image className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-slate-400" />
              )}
              {navn}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

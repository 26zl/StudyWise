"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Bot, User } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { CodeBlock } from "@/app/components/ui/CodeBlock";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { fetchApi } from "@/app/lib/apiClient";
import { parseApiError } from "@/app/lib/errorUtils";
import { showToast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";
import {
  SharedChatPublicResponseSchema,
  type SharedChatPublicResponse,
} from "common/chat";

const markdownKomponenter: Components = {
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
};

export default function SharePage() {
  const params = useParams<{ shareId: string }>();
  const router = useRouter();
  const [data, setData] = useState<SharedChatPublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    const shareId = typeof params?.shareId === "string" ? params.shareId : "";
    if (!shareId) {
      setLoading(false);
      setError("Mangler delingslenke.");
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);
    setData(null);

    (async () => {
      try {
        const res = await fetchApi(
          `/api/ki/share/${shareId}`,
          { signal: ac.signal },
          { auth: false, credentials: "omit", cache: "no-store" },
        );
        if (cancelled) return;
        if (!res.ok) {
          setError(await parseApiError(res, "Kunne ikke hente delt samtale."));
          return;
        }
        const parsed = SharedChatPublicResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          setError("Ugyldig data fra server.");
          return;
        }
        setData(parsed.data);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setError("Noe gikk galt ved henting av samtalen.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [params?.shareId]);

  if (loading) return <LoadingView text="Laster delt samtale..." fullPage />;

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <FeilMelding melding={error ?? "Den delte samtalen finnes ikke."} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Dette er en delt StudyWise-samtale
          </p>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Prøv StudyWise
          </Link>
        </div>
        <div className="mx-auto flex max-w-4xl items-center justify-end px-4 pb-3">
          <button
            type="button"
            onClick={async () => {
              if (!data) return;
              if (!isSignedIn) {
                const redirectUrl = `${window.location.pathname}${window.location.search}`;
                router.push(`/auth/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
                return;
              }
              const res = await fetchApi("/api/ki/chat/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messages: data.messages.map((m) => ({ rolle: m.rolle, innhold: m.innhold })),
                  title: data.chatTitle,
                }),
              });
              if (!res.ok) {
                showToast.error("Kunne ikke starte samtalen");
                return;
              }
              const json = await res.json().catch(() => null);
              const chatId =
                json &&
                typeof json === "object" &&
                "chat" in json &&
                json.chat &&
                typeof json.chat === "object" &&
                "id" in json.chat &&
                typeof json.chat.id === "string"
                  ? json.chat.id
                  : null;
              if (chatId) {
                setSelectedChatId(chatId);
                setCurrentChatId(chatId);
              }
              showToast.success("Samtalen ble kopiert til StudyWise");
              router.push("/dashboard");
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Opprett kopi i StudyWise
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{data.chatTitle}</h1>
        {data.messages.map((melding, index) => (
          <div
            key={index}
            className={`flex items-start gap-3 ${melding.rolle === "user" ? "justify-end" : "justify-start"}`}
          >
            {melding.rolle === "assistant" && (
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40">
                <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
            )}

            <div className={melding.rolle === "user" ? "max-w-[80%]" : "w-full min-w-0"}>
              <div
                className={
                  melding.rolle === "user"
                    ? "rounded-2xl bg-stone-100 px-5 py-3.5 text-slate-900 dark:bg-slate-700 dark:text-white"
                    : "text-slate-900 dark:text-white"
                }
              >
                {melding.rolle === "assistant" ? (
                  <div className="prose prose-base max-w-none prose-p:my-2 prose-p:leading-relaxed prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                      components={markdownKomponenter}
                    >
                      {melding.innhold}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{melding.innhold}</p>
                )}
              </div>
            </div>

            {melding.rolle === "user" && (
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-600">
                <User className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

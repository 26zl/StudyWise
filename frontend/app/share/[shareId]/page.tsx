"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Bot, User } from "lucide-react";
import { ConversationMessageContent } from "@/app/components/chat/ConversationMessageContent";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { fetchApi } from "@/app/lib/apiClient";
import { parseApiError } from "@/app/lib/errorUtils";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { useUIStore } from "@/app/store/uiStore";
import {
  SharedChatPublicResponseSchema,
  type SharedChatPublicResponse,
} from "common/chat";

export default function SharePage() {
  const params = useParams<{ shareId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<SharedChatPublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { t } = useLanguage();
  const redirectQuery = searchParams.toString();
  const redirectUrl = `${pathname}${redirectQuery ? `?${redirectQuery}` : ""}`;
  const signInHref = `/auth/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;
  const signUpHref = `/auth/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;

  useEffect(() => {
    const shareId = typeof params?.shareId === "string" ? params.shareId : "";
    if (!shareId) {
      setLoading(false);
      setError(t("sharePage.missingShareLink"));
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
          setError(await parseApiError(res, t("sharePage.fetchShareError")));
          return;
        }
        const parsed = SharedChatPublicResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          setError(t("sharePage.invalidShareData"));
          return;
        }
        setData(parsed.data);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setError(t("sharePage.genericFetchError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [params?.shareId, t]);

  if (loading) return <LoadingView text={t("sharePage.loadingShare")} fullPage />;

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md">
          <FeilMelding melding={error ?? t("sharePage.missingShare")} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("sharePage.sharedHeader")}
          </p>
          <Link
            href={authLoaded && isSignedIn ? "/dashboard" : signUpHref}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {authLoaded && isSignedIn ? t("sharePage.openDashboard") : t("sharePage.tryStudyWise")}
          </Link>
        </div>
        <div className="mx-auto flex max-w-4xl items-center justify-end px-4 pb-3">
          <button
            type="button"
            onClick={async () => {
              if (!data || isCopying) return;
              if (!authLoaded) {
                return;
              }
              if (!isSignedIn) {
                router.push(signInHref);
                return;
              }
              setIsCopying(true);
              try {
                const res = await fetchApi("/api/ki/chat/history", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    messages: data.messages.map((m) => ({ rolle: m.rolle, innhold: m.innhold })),
                    title: data.chatTitle,
                  }),
                });
                if (!res.ok) {
                  showToast.error(t("sharePage.couldNotStartConversation"));
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
                if (!chatId) {
                  showToast.error(t("sharePage.couldNotStartConversation"));
                  return;
                }
                setSelectedChatId(chatId);
                setCurrentChatId(chatId);
                showToast.success(t("sharePage.conversationCopied"));
                router.push("/dashboard");
              } finally {
                setIsCopying(false);
              }
            }}
            disabled={!authLoaded || isCopying}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isCopying ? t("sharePage.copyingConversation") : authLoaded ? t("sharePage.continueConversation") : t("sharePage.checkingAuth")}
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{data.chatTitle}</h1>
        {data.messages.map((melding, index) => (
          <div
            key={`${index}-${melding.rolle}`}
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
                <ConversationMessageContent message={melding} />
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

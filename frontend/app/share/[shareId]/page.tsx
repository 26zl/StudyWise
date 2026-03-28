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
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { language } = useLanguage();
  const erEngelsk = language === "en";
  const redirectQuery = searchParams.toString();
  const redirectUrl = `${pathname}${redirectQuery ? `?${redirectQuery}` : ""}`;
  const signInHref = `/auth/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;
  const signUpHref = `/auth/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;
  const tekster = {
    missingShareLink: erEngelsk ? "Missing share link." : "Mangler delingslenke.",
    fetchShareError: erEngelsk
      ? "Could not fetch shared conversation."
      : "Kunne ikke hente delt samtale.",
    invalidShareData: erEngelsk ? "Invalid data from server." : "Ugyldig data fra server.",
    genericFetchError: erEngelsk
      ? "Something went wrong while fetching the conversation."
      : "Noe gikk galt ved henting av samtalen.",
    loadingShare: erEngelsk ? "Loading shared conversation..." : "Laster delt samtale...",
    missingShare: erEngelsk
      ? "The shared conversation does not exist."
      : "Den delte samtalen finnes ikke.",
    sharedHeader: erEngelsk
      ? "This is a shared StudyWise conversation"
      : "Dette er en delt StudyWise-samtale",
    tryStudyWise: erEngelsk ? "Try StudyWise" : "Prøv StudyWise",
    openDashboard: erEngelsk ? "Open dashboard" : "Åpne dashboard",
    continueConversation: erEngelsk
      ? "Continue the conversation in StudyWise"
      : "Fortsett samtalen i StudyWise",
    checkingAuth: erEngelsk ? "Checking sign-in..." : "Sjekker innlogging...",
    couldNotStartConversation: erEngelsk
      ? "Could not start the conversation"
      : "Kunne ikke starte samtalen",
    conversationCopied: erEngelsk
      ? "The conversation was copied to StudyWise"
      : "Samtalen ble kopiert til StudyWise",
  };

  useEffect(() => {
    const shareId = typeof params?.shareId === "string" ? params.shareId : "";
    if (!shareId) {
      setLoading(false);
      setError(tekster.missingShareLink);
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
          setError(await parseApiError(res, tekster.fetchShareError));
          return;
        }
        const parsed = SharedChatPublicResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          setError(tekster.invalidShareData);
          return;
        }
        setData(parsed.data);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setError(tekster.genericFetchError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    params?.shareId,
    tekster.fetchShareError,
    tekster.genericFetchError,
    tekster.invalidShareData,
    tekster.missingShareLink,
  ]);

  if (loading) return <LoadingView text={tekster.loadingShare} fullPage />;

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <FeilMelding melding={error ?? tekster.missingShare} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {tekster.sharedHeader}
          </p>
          <Link
            href={authLoaded && isSignedIn ? "/dashboard" : signUpHref}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {authLoaded && isSignedIn ? tekster.openDashboard : tekster.tryStudyWise}
          </Link>
        </div>
        <div className="mx-auto flex max-w-4xl items-center justify-end px-4 pb-3">
          <button
            type="button"
            onClick={async () => {
              if (!data) return;
              if (!authLoaded) {
                return;
              }
              if (!isSignedIn) {
                router.push(signInHref);
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
                showToast.error(tekster.couldNotStartConversation);
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
              showToast.success(tekster.conversationCopied);
              router.push("/dashboard");
            }}
            disabled={!authLoaded}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {authLoaded ? tekster.continueConversation : tekster.checkingAuth}
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

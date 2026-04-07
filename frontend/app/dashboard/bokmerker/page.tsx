"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Pin, Search } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import {
  skalRedirecteTilAuth,
  useAuthRedirect,
  useFatalAuthSignOut,
} from "@/app/auth/authUtils";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import { ConversationListItem } from "@/app/components/dashboard/ConversationListItem";
import {
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { getBrukerdataFeilmelding } from "@/app/lib/errorUtils";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { lagSamtaleForhandsvisning } from "@/app/components/chat/conversationMessageUtils";
import { formaterDatoShort } from "@/app/lib/dato";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";

export default function BokmerkerPage() {
  const router = useRouter();
  const { isLoaded } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded });
  useAuthRedirect(megQuery);
  const erFatalAuthFeil = useFatalAuthSignOut(megQuery);

  const { chats, loading: chatsLoading, setChatPinned } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");

  const brukernavn =
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];
  const brukerRolle = megQuery.data?.user?.role;

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  const åpneSamtale = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      setCurrentChatId(chatId);
      router.push("/dashboard");
    },
    [router, setCurrentChatId, setSelectedChatId],
  );

  const filteredChats = useMemo(() => {
    const term = query.trim().toLowerCase();
    return chats.filter((chat) => {
      if (!chat.pinned) return false;
      if (!term) return true;
      return (
        chat.title.toLowerCase().includes(term) ||
        chat.messages.some((message) => message.innhold.toLowerCase().includes(term))
      );
    });
  }, [chats, query]);

  if (megQuery.isPending || !isLoaded || chatsLoading) {
    return <LoadingView text={t("bokmerker.loading")} />;
  }

  if (skalRedirecteTilAuth(megQuery) || erFatalAuthFeil) {
    const label = skalRedirecteTilAuth(megQuery)
      ? t("common.loading.redirectingToSignIn")
      : t("common.loading.generic");
    return <LoadingView text={label} />;
  }

  if (megQuery.isError && !megQuery.data?.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-4">
        <FeilMelding melding={getBrukerdataFeilmelding(megQuery.error, t)} />
        <button
          type="button"
          onClick={() => { void megQuery.refetch(); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <SidebarAppShell
      aktivVisning="chat"
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      brukerRolle={brukerRolle}
    >
      <div className="min-h-full bg-white px-4 py-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">{t("bokmerker.title")}</h1>
          </div>

          <div className="mb-4">
            <label htmlFor="bookmarks-search" className="sr-only">
              {t("bokmerker.searchLabel")}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="bookmarks-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("bokmerker.searchPlaceholder")}
                aria-label={t("bokmerker.searchLabel")}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          {filteredChats.length === 0 ? (
            <FeilMelding
              melding={
                query.trim().length > 0
                  ? t("bokmerker.noSearchMatches")
                  : t("dashboard.sidebar.noBookmarksYet")
              }
              type="info"
            />
          ) : (
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <ConversationListItem
                  key={chat.id}
                  title={chat.title}
                  preview={lagSamtaleForhandsvisning(chat.messages, chat.title)}
                  meta={formaterDatoShort(chat.timestamp, language)}
                  onOpen={() => åpneSamtale(chat.id)}
                  footer={(
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await setChatPinned(chat.id, false);
                        if (ok) {
                          showToast.success(t("bokmerker.removedFromBookmarks"));
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                    >
                      <Pin className="h-3.5 w-3.5" />
                      {t("bokmerker.unpin")}
                    </button>
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </SidebarAppShell>
  );
}

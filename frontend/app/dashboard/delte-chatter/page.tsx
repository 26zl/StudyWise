"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Pin, Search } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { formaterDatoShort } from "@/app/lib/dato";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";

export default function DelteChatterPage() {
  const router = useRouter();
  const { isLoaded } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded });
  useAuthRedirect(megQuery);
  const { chats, loading: chatsLoading, setChatPinned } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");

  const brukernavn =
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];
  const brukerRolle = megQuery.data?.user?.role;
  const erEngelsk = language === "en";
  const tekster = {
    title: erEngelsk ? "My bookmarks" : "Mine bokmerker",
    loading: erEngelsk ? "Loading bookmarks..." : "Laster bokmerker...",
    searchLabel: erEngelsk ? "Search bookmarked conversations" : "Søk i bokmerkede chatter",
    searchPlaceholder: erEngelsk ? "Search conversations..." : "Søk i chatter...",
    noSearchMatches: erEngelsk
      ? "No bookmarked conversations match your search."
      : "Ingen bokmerkede chatter matcher søket.",
    removedFromBookmarks: erEngelsk ? "Removed from bookmarks" : "Fjernet fra bokmerker",
    unpin: erEngelsk ? "Remove bookmark" : "Fjern bokmerke",
  };

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
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
        label={tekster.loading}
      />
    );
  }

  if (skalRedirecteTilAuth(megQuery)) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukerRolle={brukerRolle}
        label={t("common.loading.redirectingToSignIn")}
      />
    );
  }

  if (megQuery.isError && !megQuery.data?.user) {
    return (
      <SidebarAppErrorState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukerRolle={brukerRolle}
        message={t("errors.userData.generic")}
        onRetry={() => {
          void megQuery.refetch();
        }}
      />
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
            <h1 className="text-2xl font-semibold">{tekster.title}</h1>
          </div>

          <div className="mb-4">
            <label htmlFor="bookmarks-search" className="sr-only">
              {tekster.searchLabel}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="bookmarks-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tekster.searchPlaceholder}
                aria-label={tekster.searchLabel}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          {filteredChats.length === 0 ? (
            <FeilMelding
              melding={
                query.trim().length > 0
                  ? tekster.noSearchMatches
                  : t("dashboard.sidebar.noBookmarksYet")
              }
              type="info"
            />
          ) : (
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <BookmarkedThreadRow
                  key={chat.id}
                  title={chat.title}
                  preview={chat.messages[chat.messages.length - 1]?.innhold ?? ""}
                  date={formaterDatoShort(chat.timestamp, language)}
                  onOpen={() => åpneSamtale(chat.id)}
                  onTogglePin={async () => {
                    const ok = await setChatPinned(chat.id, false);
                    if (ok) {
                      showToast.success(tekster.removedFromBookmarks);
                    }
                  }}
                  unpinLabel={tekster.unpin}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </SidebarAppShell>
  );
}

function BookmarkedThreadRow({
  title,
  preview,
  date,
  onOpen,
  onTogglePin,
  unpinLabel,
}: {
  title: string;
  preview: string;
  date: string;
  onOpen: () => void;
  onTogglePin: () => Promise<void>;
  unpinLabel: string;
}) {
  return (
    <article className="rounded-lg border-b border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-lg px-1 pt-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:hover:bg-slate-800/50"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-lg font-semibold">{title}</p>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{preview}</p>
        <p className="mt-2 text-xs text-slate-500">{date}</p>
      </button>
      <div className="flex items-center justify-end px-1 pb-4 pt-3">
        <button
          type="button"
          onClick={async () => {
            await onTogglePin();
          }}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
        >
          <Pin className="h-3.5 w-3.5" />
          {unpinLabel}
        </button>
      </div>
    </article>
  );
}

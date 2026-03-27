"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Pin, Search, Trash2, Users } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { fetchApi } from "@/app/lib/apiClient";
import { formaterDatoShort } from "@/app/lib/dato";
import { parseApiError } from "@/app/lib/errorUtils";
import { useLanguage } from "@/app/i18n";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast, toast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";
import { SharedChatListResponseSchema, type SharedChatListItem } from "common/chat";

type SamtalerTab = "history" | "shared";

function parseTab(value: string | null): SamtalerTab {
  if (value === "shared") {
    return value;
  }
  return "history";
}

export default function SamtalehistorikkPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded });
  useAuthRedirect(megQuery);
  const { chats, loading: chatsLoading, deleteChat, clearAll } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language, t } = useLanguage();
  const [historyQuery, setHistoryQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<SharedChatListItem[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [deletingAllLinks, setDeletingAllLinks] = useState(false);

  const rawTab = searchParams.get("tab");
  const aktivTab = parseTab(rawTab);
  const skalTilBookmarks = rawTab === "pinned";
  const brukernavn =
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];
  const brukerRolle = megQuery.data?.user?.role;
  const erEngelsk = language === "en";
  const tekster = {
    redirectingBookmarks: erEngelsk ? "Redirecting you to bookmarks..." : "Sender deg til bokmerker...",
    title: t("dashboard.sidebar.chatHistory"),
    clearAll: t("common.actions.clearAll"),
    historyTab: erEngelsk ? "History" : "Historikk",
    sharedTab: erEngelsk ? "Shared chats" : "Delte chatter",
    searchLabel: erEngelsk ? "Search all conversations" : "Søk i alle samtaler",
    searchPlaceholder: erEngelsk ? "Search all conversations..." : "Søk i alle samtaler...",
    sortLabel: erEngelsk ? "Sort conversations" : "Sorter samtaler",
    newestFirst: erEngelsk ? "Newest first" : "Nyeste først",
    oldestFirst: erEngelsk ? "Oldest first" : "Eldste først",
    select: erEngelsk ? "Select" : "Velg",
    cancelSelection: erEngelsk ? "Cancel selection" : "Avbryt valg",
    deleteSelected: (count: number) =>
      erEngelsk ? `Delete selected (${count})` : `Slett valgte (${count})`,
    noSearchMatches: erEngelsk
      ? "No conversations match your search."
      : "Ingen samtaler matcher søket.",
    bookmarked: erEngelsk ? "Bookmarked" : "Bokmerket",
    loadSharedError: erEngelsk ? "Could not load shared chats" : "Kunne ikke hente delte chatter",
    deleteAllSharedTitle: erEngelsk ? "Delete all shared chats?" : "Slett alle delte chatter?",
    deleteAllSharedDescription: erEngelsk
      ? "All active share links will be removed. This cannot be undone."
      : "Alle aktive delingslenker fjernes. Dette kan ikke angres.",
    deleteAllSharedSuccess: erEngelsk
      ? "All shared chats deleted"
      : "Alle delte chatter slettet",
    deleteAllSharedError: erEngelsk
      ? "Could not delete shared chats"
      : "Kunne ikke slette delte chatter",
    loadingShared: erEngelsk ? "Loading shared chats..." : "Laster delte chatter...",
    noSharedChats: erEngelsk ? "No shared chats yet." : "Ingen delte chatter ennå.",
    copyLink: erEngelsk ? "Copy link" : "Kopier lenke",
    linkCopied: erEngelsk ? "Link copied" : "Lenke kopiert",
    copyLinkError: erEngelsk ? "Could not copy the link" : "Kunne ikke kopiere lenken",
    deleteShareError: erEngelsk
      ? "Could not delete share link"
      : "Kunne ikke slette delingslenke",
    deleteShareSuccess: erEngelsk ? "Share link deleted" : "Delingslenke slettet",
    sharedViews: (count: number) =>
      erEngelsk
        ? `${count} ${count === 1 ? "view" : "views"}`
        : `${count} ${count === 1 ? "visning" : "visninger"}`,
  };

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  const byttTab = useCallback(
    (nesteTab: SamtalerTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nesteTab === "history") {
        params.delete("tab");
      } else {
        params.set("tab", nesteTab);
      }

      const query = params.toString();
      router.replace(query ? `/dashboard/samtalehistorikk?${query}` : "/dashboard/samtalehistorikk", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  const åpneSamtale = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      setCurrentChatId(chatId);
      router.push("/dashboard");
    },
    [router, setCurrentChatId, setSelectedChatId],
  );

  const loadLinks = useCallback(async () => {
    setLoadingLinks(true);
    try {
      const res = await fetchApi("/api/ki/chat/shared");
      if (!res.ok) {
        throw new Error(await parseApiError(res, tekster.loadSharedError));
      }
      const parsed = SharedChatListResponseSchema.parse(await res.json());
      setLinks(parsed.links);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : tekster.loadSharedError);
      setLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  }, [tekster.loadSharedError]);

  useEffect(() => {
    if (skalTilBookmarks) {
      router.replace("/dashboard/delte-chatter", { scroll: false });
    }
  }, [router, skalTilBookmarks]);

  useEffect(() => {
    if (isLoaded && aktivTab === "shared") {
      void loadLinks();
    }
  }, [isLoaded, aktivTab, loadLinks]);

  useEffect(() => {
    if (aktivTab !== "history") {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [aktivTab]);

  const filteredHistoryChats = useMemo(() => {
    const filtered = chats.filter((chat) => {
      const term = historyQuery.trim().toLowerCase();
      if (!term) return true;
      return (
        chat.title.toLowerCase().includes(term) ||
        chat.messages.some((message) => message.innhold.toLowerCase().includes(term))
      );
    });

    return [...filtered].sort((a, b) =>
      sortOrder === "newest"
        ? b.timestamp.getTime() - a.timestamp.getTime()
        : a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }, [chats, historyQuery, sortOrder]);

  const handleDeleteAllSharedChats = useCallback(() => {
    toast(tekster.deleteAllSharedTitle, {
      description: tekster.deleteAllSharedDescription,
      position: "top-center",
      action: {
        label: t("common.actions.delete"),
        onClick: async () => {
          if (deletingAllLinks) {
            return;
          }

          setDeletingAllLinks(true);
          try {
            const res = await fetchApi("/api/ki/chat/shared", { method: "DELETE" });
            if (!res.ok) {
              showToast.error(await parseApiError(res, tekster.deleteAllSharedError));
              return;
            }

            setLinks([]);
            showToast.success(tekster.deleteAllSharedSuccess);
          } catch (error) {
            showToast.error(
              error instanceof Error ? error.message : tekster.deleteAllSharedError,
            );
          } finally {
            setDeletingAllLinks(false);
          }
        },
      },
      cancel: { label: t("common.actions.cancel"), onClick: () => {} },
    });
  }, [
    deletingAllLinks,
    t,
    tekster.deleteAllSharedDescription,
    tekster.deleteAllSharedError,
    tekster.deleteAllSharedSuccess,
    tekster.deleteAllSharedTitle,
  ]);

  if (skalTilBookmarks) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
        label={tekster.redirectingBookmarks}
      />
    );
  }

  if (megQuery.isPending || !isLoaded || chatsLoading) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
        label={t("common.loading.chatHistory")}
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
            {aktivTab === "history" && chats.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" />
                {tekster.clearAll}
              </button>
            ) : null}
            {aktivTab === "shared" && links.length > 0 ? (
              <button
                type="button"
                onClick={handleDeleteAllSharedChats}
                disabled={deletingAllLinks}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" />
                {tekster.clearAll}
              </button>
            ) : null}
          </div>

          <div className="mb-5 flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => byttTab("history")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${
                aktivTab === "history"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              {tekster.historyTab}
            </button>
            <button
              type="button"
              onClick={() => byttTab("shared")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${
                aktivTab === "shared"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500"
              }`}
            >
              <Users className="h-4 w-4" />
              {tekster.sharedTab}
            </button>
          </div>

          {aktivTab === "history" ? (
            <>
              <div className="mb-4">
                <label htmlFor="samtalehistorikk-search" className="sr-only">
                  {tekster.searchLabel}
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="samtalehistorikk-search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder={tekster.searchPlaceholder}
                    aria-label={tekster.searchLabel}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <label htmlFor="samtalehistorikk-sort" className="sr-only">
                  {tekster.sortLabel}
                </label>
                <select
                  id="samtalehistorikk-sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
                  aria-label={tekster.sortLabel}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="newest">{tekster.newestFirst}</option>
                  <option value="oldest">{tekster.oldestFirst}</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((prev) => !prev);
                    setSelectedIds(new Set());
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                >
                  {selectMode ? tekster.cancelSelection : tekster.select}
                </button>
                {selectMode ? (
                  <button
                    type="button"
                    disabled={selectedIds.size === 0}
                    onClick={async () => {
                      const ids = Array.from(selectedIds);
                      const feiledeIds = new Set<string>();

                      for (const id of ids) {
                        const ok = await deleteChat(id);
                        if (!ok) {
                          feiledeIds.add(id);
                        }
                      }

                      setSelectedIds(feiledeIds);
                      if (feiledeIds.size === 0) {
                        setSelectMode(false);
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                    {tekster.deleteSelected(selectedIds.size)}
                  </button>
                ) : null}
              </div>

              {filteredHistoryChats.length === 0 ? (
                <FeilMelding
                  melding={
                    historyQuery.trim().length > 0
                      ? tekster.noSearchMatches
                      : t("dashboard.sidebar.noChatsYet")
                  }
                  type="info"
                />
              ) : (
                <div className="space-y-1">
                  {filteredHistoryChats.map((chat) => (
                    <article
                      key={chat.id}
                      className="rounded-lg border-b border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-start gap-2 px-1 py-4">
                        {selectMode ? (
                          <input
                            type="checkbox"
                            aria-label={`Velg "${chat.title}"`}
                            checked={selectedIds.has(chat.id)}
                            onChange={() => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(chat.id)) next.delete(chat.id);
                                else next.add(chat.id);
                                return next;
                              });
                            }}
                            className="mt-1 h-4 w-4 shrink-0"
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            if (selectMode) {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(chat.id)) next.delete(chat.id);
                                else next.add(chat.id);
                                return next;
                              });
                              return;
                            }
                            åpneSamtale(chat.id);
                          }}
                          className="w-full rounded-lg text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:hover:bg-slate-800/50"
                        >
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 opacity-60" />
                            <p className="truncate text-lg font-semibold">{chat.title}</p>
                            {chat.pinned ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                <Pin className="h-3 w-3" />
                                {tekster.bookmarked}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
                            {chat.messages[chat.messages.length - 1]?.innhold ?? ""}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formaterDatoShort(chat.timestamp, language)}
                          </p>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {aktivTab === "shared" ? (
            <>
              {loadingLinks ? (
                <LoadingView text={tekster.loadingShared} fullPage={false} />
              ) : links.length === 0 ? (
                <FeilMelding melding={tekster.noSharedChats} type="info" />
              ) : (
                <div className="space-y-1">
                  {links.map((item) => (
                    <article
                      key={item.shareId}
                      className="rounded-lg border-b border-slate-200 dark:border-slate-800"
                    >
                      <button
                        type="button"
                        className="w-full rounded-lg px-1 pt-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:hover:bg-slate-800/50"
                        onClick={() => åpneSamtale(item.chatId)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-lg font-semibold">{item.chatTitle}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {formaterDatoShort(item.createdAt, language)} · {tekster.sharedViews(item.viewCount)}
                        </p>
                      </button>
                      <div className="flex items-center justify-end gap-2 px-1 pb-4 pt-3">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const fullUrl = `${window.location.origin}${item.shareUrl}`;
                              await navigator.clipboard.writeText(fullUrl);
                              toast(tekster.linkCopied);
                            } catch {
                              showToast.error(tekster.copyLinkError);
                            }
                          }}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                        >
                          {tekster.copyLink}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetchApi(`/api/ki/chat/shared/${item.shareId}`, {
                              method: "DELETE",
                            });
                            if (!res.ok) {
                              showToast.error(
                                await parseApiError(res, tekster.deleteShareError),
                              );
                              return;
                            }
                            setLinks((prev) =>
                              prev.filter((link) => link.shareId !== item.shareId),
                            );
                            showToast.success(tekster.deleteShareSuccess);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800 dark:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("common.actions.delete")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </SidebarAppShell>
  );
}

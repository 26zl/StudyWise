"use client";

/**
 * Samtaler-side med tab for egen chat-historikk og delte chat-lenker.
 * Route-wrapper: app/dashboard/samtalehistorikk/page.tsx re-eksporterer denne som default.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { MessageSquare, Pin, Search, Trash2, Users } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import {
  skalRedirecteTilAuth,
  useAuthRedirect,
  useFatalAuthSignOut,
} from "@/app/auth/authUtils";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { fetchApi } from "@/app/lib/apiClient";
import { lagSamtaleForhandsvisning } from "@/app/components/chat/conversationMessageUtils";
import { formaterDatoShort } from "@/app/lib/dato";
import {
  getBrukerdataFeilmelding,
  parseApiError,
} from "@/app/lib/errorUtils";
import { useLanguage } from "@/app/i18n";
import { ConversationListItem } from "@/app/components/dashboard/ConversationListItem";
import { showToast, toast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";
import { SharedChatListResponseSchema, type SharedChatListItem } from "common/chat";

type SamtalerTab = "history" | "shared";

export function SamtalerPage() {
  const router = useRouter();
  // clearOnDefault: false holder `?tab=history` synlig i URL-en også for default-tab-en,
  // slik at valgt fane alltid er dyplinkbar og synlig for brukeren (matcher "shared").
  const [aktivTab, setAktivTab] = useQueryState(
    "tab",
    parseAsStringLiteral(["history", "shared"] as const)
      .withDefault("history")
      .withOptions({ clearOnDefault: false, history: "replace" }),
  );
  const { isLoaded, userId } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded && !!userId });
  useAuthRedirect(megQuery);
  const erFatalAuthFeil = useFatalAuthSignOut(megQuery);

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
  const sharedViews = (count: number) =>
    count === 1
      ? t("samtalehistorikk.sharedViewsSingular", { count })
      : t("samtalehistorikk.sharedViewsPlural", { count });

  const byttTab = useCallback(
    (nesteTab: SamtalerTab) => {
      void setAktivTab(nesteTab, { history: "replace", scroll: false });
    },
    [setAktivTab],
  );

  // Ved første besøk uten tab-param — skriv aktiv tab til URL-en så den vises.
  // setAktivTab med samme verdi er idempotent; gjøres kun én gang per mount.
  useEffect(() => {
    void setAktivTab(aktivTab, { history: "replace", scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        throw new Error(await parseApiError(res, t("samtalehistorikk.loadSharedError")));
      }
      const parsed = SharedChatListResponseSchema.parse(await res.json());
      setLinks(parsed.links);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t("samtalehistorikk.loadSharedError"));
      setLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  }, [t]);

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
    toast(t("samtalehistorikk.deleteAllSharedTitle"), {
      description: t("samtalehistorikk.deleteAllSharedDescription"),
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
              showToast.error(await parseApiError(res, t("samtalehistorikk.deleteAllSharedError")));
              return;
            }

            setLinks([]);
            showToast.success(t("samtalehistorikk.deleteAllSharedSuccess"));
          } catch (error) {
            showToast.error(
              error instanceof Error ? error.message : t("samtalehistorikk.deleteAllSharedError"),
            );
          } finally {
            setDeletingAllLinks(false);
          }
        },
      },
      cancel: { label: t("common.actions.cancel"), onClick: () => {} },
    });
  }, [deletingAllLinks, t]);

  if (megQuery.isPending || !isLoaded || chatsLoading) {
    return <LoadingView text={t("common.loading.chatHistory")} />;
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
      <div className="min-h-full px-4 py-6 text-slate-900 dark:text-slate-100 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">{t("dashboard.sidebar.chatHistory")}</h1>
            {aktivTab === "history" && chats.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" />
                {t("common.actions.clearAll")}
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
                {t("common.actions.clearAll")}
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
              {t("samtalehistorikk.historyTab")}
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
              {t("samtalehistorikk.sharedTab")}
            </button>
          </div>

          {aktivTab === "history" ? (
            <>
              <div className="mb-4">
                <label htmlFor="samtalehistorikk-search" className="sr-only">
                  {t("samtalehistorikk.searchLabel")}
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="samtalehistorikk-search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder={t("samtalehistorikk.searchPlaceholder")}
                    aria-label={t("samtalehistorikk.searchLabel")}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <label htmlFor="samtalehistorikk-sort" className="sr-only">
                  {t("samtalehistorikk.sortLabel")}
                </label>
                <select
                  id="samtalehistorikk-sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
                  aria-label={t("samtalehistorikk.sortLabel")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="newest">{t("samtalehistorikk.newestFirst")}</option>
                  <option value="oldest">{t("samtalehistorikk.oldestFirst")}</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((prev) => !prev);
                    setSelectedIds(new Set());
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                >
                  {selectMode ? t("samtalehistorikk.cancelSelection") : t("samtalehistorikk.select")}
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
                    {t("samtalehistorikk.deleteSelected", { count: selectedIds.size })}
                  </button>
                ) : null}
              </div>

              {filteredHistoryChats.length === 0 ? (
                <FeilMelding
                  melding={
                    historyQuery.trim().length > 0
                      ? t("samtalehistorikk.noSearchMatches")
                      : t("dashboard.sidebar.noChatsYet")
                  }
                  type="info"
                />
              ) : (
                <div className="space-y-1">
                  {filteredHistoryChats.map((chat) => (
                    <ConversationListItem
                      key={chat.id}
                      title={chat.title}
                      preview={lagSamtaleForhandsvisning(chat.messages, chat.title)}
                      meta={formaterDatoShort(chat.timestamp, language)}
                      onOpen={() => {
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
                      leadingControl={selectMode ? (
                        <input
                          type="checkbox"
                          aria-label={t("chatHistory.selectChat", { title: chat.title })}
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
                      titleIcon={<MessageSquare className="h-4 w-4 opacity-60" />}
                      titleBadge={chat.pinned ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <Pin className="h-3 w-3" />
                          {t("samtalehistorikk.bookmarked")}
                        </span>
                      ) : null}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}

          {aktivTab === "shared" ? (
            <>
              {loadingLinks ? (
                <LoadingView text={t("samtalehistorikk.loadingShared")} fullPage={false} />
              ) : links.length === 0 ? (
                <FeilMelding melding={t("samtalehistorikk.noSharedChats")} type="info" />
              ) : (
                <div className="space-y-1">
                  {links.map((item) => (
                    <ConversationListItem
                      key={item.shareId}
                      title={item.chatTitle}
                      meta={`${formaterDatoShort(item.createdAt, language)} · ${sharedViews(item.viewCount)}`}
                      onOpen={() => åpneSamtale(item.chatId)}
                      footer={(
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const fullUrl = `${window.location.origin}${item.shareUrl}`;
                                await navigator.clipboard.writeText(fullUrl);
                                toast(t("samtalehistorikk.linkCopied"));
                              } catch {
                                showToast.error(t("samtalehistorikk.copyLinkError"));
                              }
                            }}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                          >
                            {t("samtalehistorikk.copyLink")}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetchApi(`/api/ki/chat/shared/${item.shareId}`, {
                                method: "DELETE",
                              });
                              if (!res.ok) {
                                showToast.error(
                                  await parseApiError(res, t("samtalehistorikk.deleteShareError")),
                                );
                                return;
                              }
                              setLinks((prev) =>
                                prev.filter((link) => link.shareId !== item.shareId),
                              );
                              showToast.success(t("samtalehistorikk.deleteShareSuccess"));
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800 dark:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("common.actions.delete")}
                          </button>
                        </>
                      )}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
  );
}

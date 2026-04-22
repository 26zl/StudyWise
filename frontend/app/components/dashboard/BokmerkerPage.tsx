"use client";

/**
 * Bokmerker-side med tab for bokmerkede chats og kunnskapsbase.
 * Route-wrapper: app/dashboard/bokmerker/page.tsx re-eksporterer denne som default.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { Pin, Search, Database, Plus } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import {
  skalRedirecteTilAuth,
  useAuthRedirect,
  useFatalAuthSignOut,
} from "@/app/auth/authUtils";
import { ConversationListItem } from "@/app/components/dashboard/ConversationListItem";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { getBrukerdataFeilmelding } from "@/app/lib/errorUtils";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { lagSamtaleForhandsvisning } from "@/app/components/chat/conversationMessageUtils";
import { formaterDatoShort } from "@/app/lib/dato";
import { useLanguage } from "@/app/i18n";
import { showToast } from "@/app/components/ui/Toaster";
import { useUIStore } from "@/app/store/uiStore";
import { KbListe } from "@/app/components/kunnskapsbase/KbListe";
import { KbDetaljer } from "@/app/components/kunnskapsbase/KbDetaljer";

type ActiveTab = "bookmarks" | "knowledgeBase";

export function BokmerkerPage() {
  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded && !!userId });
  useAuthRedirect(megQuery);
  const erFatalAuthFeil = useFatalAuthSignOut(megQuery);

  const { chats, loading: chatsLoading, setChatPinned } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");
  // Tab-state i URL via nuqs — parseAsStringLiteral validerer at kun tillatte
  // verdier aksepteres (ugyldig tab?=xyz faller tilbake til default "bookmarks").
  // clearOnDefault: false holder `?tab=bookmarks` synlig så valgt fane er dyplinkbar.
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral(["bookmarks", "knowledgeBase"] as const)
      .withDefault("bookmarks")
      .withOptions({ clearOnDefault: false, history: "replace" }),
  );
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [visOpprettForm, setVisOpprettForm] = useState(false);

  const byttTab = useCallback(
    (nesteTab: ActiveTab) => {
      void setActiveTab(nesteTab, { history: "replace", scroll: false });
      setSelectedBaseId(null);
      setVisOpprettForm(false);
    },
    [setActiveTab],
  );

  // Skriv aktiv tab til URL ved første besøk slik at brukeren ser hvilken fane
  // som er valgt (matcher oppførselen på samtaler-siden).
  useEffect(() => {
    void setActiveTab(activeTab, { history: "replace", scroll: false });
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
      <div className="min-h-full px-4 py-6 text-slate-900 dark:text-slate-100 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{t("dashboard.sidebar.bookmarks")}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("bokmerker.pageDescription")}
              </p>
            </div>
            {activeTab === "knowledgeBase" && !selectedBaseId ? (
              <button
                type="button"
                onClick={() => setVisOpprettForm(!visOpprettForm)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <Plus className="h-4 w-4" />
                {t("kb.createBase")}
              </button>
            ) : null}
          </div>
          {/* Fane-navigasjon */}
          <div className="mb-6 flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => byttTab("bookmarks")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "bookmarks"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              <Pin className="h-4 w-4" />
              {t("bokmerker.title")}
            </button>
            <button
              type="button"
              onClick={() => byttTab("knowledgeBase")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "knowledgeBase"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              <Database className="h-4 w-4" />
              {t("kb.title")}
            </button>
          </div>

          {/* ═══ Bokmerker-fane ═══ */}
          {activeTab === "bookmarks" && (
            <>
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
            </>
          )}

          {/* ═══ Kunnskapsbase-fane ═══ */}
          {activeTab === "knowledgeBase" && (
            selectedBaseId ? (
              <KbDetaljer
                baseId={selectedBaseId}
                onBack={() => setSelectedBaseId(null)}
              />
            ) : (
              <KbListe
                onSelectBase={(id) => setSelectedBaseId(id)}
                visOpprettForm={visOpprettForm}
                setVisOpprettForm={setVisOpprettForm}
              />
            )
          )}
        </div>
      </div>
  );
}

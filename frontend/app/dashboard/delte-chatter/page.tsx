"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Link2, Pin, Search, Trash2, Users } from "lucide-react";
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
import { parseApiError } from "@/app/lib/errorUtils";
import { formaterDatoShort } from "@/app/lib/dato";
import { useLanguage } from "@/app/i18n";
import { showToast, toast } from "@/app/components/ui/Toaster";
import { LoadingView } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { useUIStore } from "@/app/store/uiStore";
import { SharedChatListResponseSchema, type SharedChatListItem } from "common/chat";

type TabType = "my" | "shared";

export default function DelteChatterPage() {
  const router = useRouter();
  const { isLoaded } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded });
  useAuthRedirect(megQuery);
  const { chats, loading: chatsLoading, setChatPinned } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language } = useLanguage();
  const [tab, setTab] = useState<TabType>("my");
  const [links, setLinks] = useState<SharedChatListItem[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [query, setQuery] = useState("");

  const brukernavn =
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];

  const byttVisning = useCallback((visning: VisningType) => {
    router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
  }, [router]);

  const loadLinks = async () => {
    setLoadingLinks(true);
    try {
      const res = await fetchApi("/api/ki/chat/shared");
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Kunne ikke hente delte chatter"));
      }
      const parsed = SharedChatListResponseSchema.parse(await res.json());
      setLinks(parsed.links);
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : "Kunne ikke hente delte chatter");
      setLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (isLoaded) {
      void loadLinks();
    }
  }, [isLoaded]);

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => {
      if (!chat.pinned) return false;
      const matchesQuery =
        query.trim() === "" ||
        chat.title.toLowerCase().includes(query.toLowerCase()) ||
        chat.messages.some((m) => m.innhold.toLowerCase().includes(query.toLowerCase()));
      return matchesQuery;
    });
  }, [chats, query]);

  if (megQuery.isPending || !isLoaded || chatsLoading) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        label="Laster tråder..."
      />
    );
  }

  if (skalRedirecteTilAuth(megQuery)) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        label="Sender deg til innlogging..."
      />
    );
  }

  if (megQuery.isError && !megQuery.data?.user) {
    return (
      <SidebarAppErrorState
        aktivVisning="chat"
        byttVisning={byttVisning}
        message="Kunne ikke laste brukerdata."
        onRetry={() => {
          void megQuery.refetch();
        }}
      />
    );
  }

  return (
    <SidebarAppShell aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn}>
      <div className="min-h-full bg-white px-4 py-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-5 flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setTab("my")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${
                tab === "my"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500"
              }`}
            >
              <Link2 className="h-4 w-4" />
              Mine bookmarks
            </button>
            <button
              type="button"
              onClick={() => setTab("shared")}
              className={`inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${
                tab === "shared"
                  ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
                  : "border-transparent text-slate-500"
              }`}
            >
              <Users className="h-4 w-4" />
              Delte chatter
            </button>
          </div>

          {tab === "my" ? (
            <>
              <div className="mb-4">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Søk i chatter..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>

              {filteredChats.length === 0 ? (
                <FeilMelding melding="Ingen bokmerkede chatter matcher filteret." type="info" />
              ) : (
                <div className="space-y-1">
                  {filteredChats.map((chat) => (
                    <ThreadRow
                      key={chat.id}
                      title={chat.title}
                      preview={chat.messages[chat.messages.length - 1]?.innhold ?? ""}
                      date={formaterDatoShort(chat.timestamp, language)}
                      onOpen={() => {
                        setSelectedChatId(chat.id);
                        setCurrentChatId(chat.id);
                        router.push("/dashboard");
                      }}
                      onTogglePin={async () => {
                        const ok = await setChatPinned(chat.id, false);
                        if (ok) showToast.success("Fjernet fra bookmarks");
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {loadingLinks ? (
                <LoadingView text="Laster delte chatter..." fullPage={false} />
              ) : links.length === 0 ? (
                <FeilMelding melding="Ingen delte chatter ennå." type="info" />
              ) : (
                <div className="space-y-1">
                  {links.map((item) => (
                    <div
                      key={item.shareId}
                      className="cursor-pointer rounded-lg border-b border-slate-200 px-1 py-4 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                      onClick={() => {
                        setSelectedChatId(item.chatId);
                        setCurrentChatId(item.chatId);
                        router.push("/dashboard");
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-lg font-semibold">{item.chatTitle}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const fullUrl = `${window.location.origin}${item.shareUrl}`;
                              void navigator.clipboard.writeText(fullUrl);
                              toast("Lenke kopiert");
                            }}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                          >
                            Kopier lenke
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const res = await fetchApi(`/api/ki/chat/shared/${item.shareId}`, { method: "DELETE" });
                              if (!res.ok) {
                                showToast.error(await parseApiError(res, "Kunne ikke slette delingslenke"));
                                return;
                              }
                              setLinks((prev) => prev.filter((link) => link.shareId !== item.shareId));
                              showToast.success("Delingslenke slettet");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-800 dark:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Slett
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formaterDatoShort(item.createdAt, language)} · {item.viewCount} visninger
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </SidebarAppShell>
  );
}

function ThreadRow({
  title,
  preview,
  date,
  onOpen,
  onTogglePin,
}: {
  title: string;
  preview: string;
  date: string;
  onOpen: () => void;
  onTogglePin: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border-b border-slate-200 px-1 py-4 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-lg font-semibold">{title}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{preview}</p>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-500">{date}</p>
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            await onTogglePin();
          }}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
        >
          <Pin className="h-3.5 w-3.5" />
          Unpin
        </button>
      </div>
    </button>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { MessageSquare, Search, Trash2 } from "lucide-react";
import { useMeg } from "@/app/auth/auth-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import { formaterDatoShort } from "@/app/lib/dato";
import { useLanguage } from "@/app/i18n";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { useUIStore } from "@/app/store/uiStore";

export default function SamtalehistorikkPage() {
  const router = useRouter();
  const { isLoaded } = useAuth();
  const megQuery = useMeg({ enabled: isLoaded });
  useAuthRedirect(megQuery);
  const { chats, loading: chatsLoading, deleteChat, clearAll } = useChatHistory();
  const { setSelectedChatId, setCurrentChatId } = useUIStore();
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const brukernavn =
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];

  const byttVisning = (visning: VisningType) => {
    router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
  };

  const filteredChats = useMemo(() => {
    const filtered = chats.filter((chat) => {
      if (chat.pinned) return false;
      const term = query.trim().toLowerCase();
      if (!term) return true;
      return (
        chat.title.toLowerCase().includes(term) ||
        chat.messages.some((m) => m.innhold.toLowerCase().includes(term))
      );
    });
    const sorted = [...filtered].sort((a, b) =>
      sortOrder === "newest"
        ? b.timestamp.getTime() - a.timestamp.getTime()
        : a.timestamp.getTime() - b.timestamp.getTime(),
    );
    return sorted;
  }, [chats, query, sortOrder]);

  if (megQuery.isPending || !isLoaded || chatsLoading) {
    return (
      <SidebarAppLoadingState
        aktivVisning="chat"
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        label="Laster historikk..."
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
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Samtaler</h1>
            {chats.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Slett alle
              </button>
            )}
          </div>
          <div className="mb-4">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Søk i alle samtaler..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="newest">Nyeste først</option>
              <option value="oldest">Eldste først</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setSelectMode((prev) => !prev);
                setSelectedIds(new Set());
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            >
              {selectMode ? "Avbryt valg" : "Velg"}
            </button>
            {selectMode && (
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={async () => {
                  const ids = Array.from(selectedIds);
                  for (const id of ids) {
                    // Reuse existing delete flow and cache update in hook
                    await deleteChat(id);
                  }
                  setSelectedIds(new Set());
                  setSelectMode(false);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
                Slett valgte ({selectedIds.size})
              </button>
            )}
          </div>

          {filteredChats.length === 0 ? (
            <FeilMelding melding="Ingen samtaler matcher søket." type="info" />
          ) : (
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <button
                  key={chat.id}
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
                    setSelectedChatId(chat.id);
                    setCurrentChatId(chat.id);
                    router.push("/dashboard");
                  }}
                  className="w-full rounded-lg border-b border-slate-200 px-1 py-4 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center gap-2">
                    {selectMode && (
                      <input
                        type="checkbox"
                        aria-label={`Velg "${chat.title}"`}
                        checked={selectedIds.has(chat.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(chat.id)) next.delete(chat.id);
                            else next.add(chat.id);
                            return next;
                          });
                        }}
                        className="h-4 w-4"
                      />
                    )}
                    <MessageSquare className="h-4 w-4 opacity-60" />
                    <p className="truncate text-lg font-semibold">{chat.title}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
                    {chat.messages[chat.messages.length - 1]?.innhold ?? ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formaterDatoShort(chat.timestamp, language)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </SidebarAppShell>
  );
}

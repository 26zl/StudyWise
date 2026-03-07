"use client";

import { useState } from "react";
import { Clock, Trash2, MessageSquare } from "lucide-react";
import type { SavedChat } from "../hooks/useChatHistory";
import { formaterDatoShort } from "../lib/dato";

// Props for ChatHistorySidebar
interface ChatHistorySidebarProps {
  chats: SavedChat[];
  selectedChatId?: string | null;
  onLoadChat: (chat: SavedChat) => void;
  onDeleteChat: (id: string) => void;
  onClearAll: () => void | Promise<void>;
}

// Hovedkomponent for ChatHistorySidebar
export function ChatHistorySidebar({
  chats,
  selectedChatId,
  onLoadChat,
  onDeleteChat,
  onClearAll,
}: ChatHistorySidebarProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="w-64 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Samtalehistorikk
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {chats.length} samtaler
        </p>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-4 text-center">
            <MessageSquare className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ingen samtaler ennå
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`group relative rounded-lg border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                  selectedChatId === chat.id ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-500/60" : ""
                }`}
              >
                <button
                  onClick={() => onLoadChat(chat)}
                  className="w-full text-left p-3 pr-10"
                >
                  <p className="text-sm text-slate-900 dark:text-white truncate mb-1">
                    {chat.title}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <Clock className="w-3 h-3" />
                    {formaterDatoShort(chat.timestamp)}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat(chat.id);
                  }}
                  className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/20 transition-all"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clear all – inline bekreftelse (ikke toast i hjørnet) */}
      {chats.length > 0 && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          {confirmClear ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Slette alle? Dette kan ikke angres.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await onClearAll();
                    setConfirmClear(false);
                  }}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors"
                >
                  Slett alle
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  Avbryt
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              Slett alle samtaler
            </button>
          )}
        </div>
      )}
    </div>
  ); 
}
 
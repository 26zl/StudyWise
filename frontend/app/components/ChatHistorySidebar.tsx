"use client";

import { Clock, Trash2, MessageSquare } from "lucide-react";
import type { SavedChat } from "../hooks/useChatHistory";

// Props for ChatHistorySidebar
interface ChatHistorySidebarProps {
  chats: SavedChat[];
  selectedChatId?: string | null;
  onLoadChat: (chat: SavedChat) => void;
  onDeleteChat: (id: string) => void;
  onClearAll: () => void;
}

// Hovedkomponent for ChatHistorySidebar
export function ChatHistorySidebar({
  chats,
  selectedChatId,
  onLoadChat,
  onDeleteChat,
  onClearAll,
}: ChatHistorySidebarProps) {
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
              Ingen samtaler ennÃ¥
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
                    {new Date(chat.timestamp).toLocaleDateString("no-NO", {
                      day: "numeric",
                      month: "short",
                    })}
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

      {/* Clear all button */}
      {chats.length > 0 && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClearAll}
            className="w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Slett alle samtaler
          </button>
        </div>
      )}
    </div>
  ); 
}
 
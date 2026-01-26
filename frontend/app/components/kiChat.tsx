/*
 * KiChat - Chat-grensesnitt inspirert av lovable.dev
 * Vises som fullskjerm overlay når bruker starter ny samtale
 */
"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface RecentItem {
  id: string;
  title: string;
  type: "presentation" | "topic" | "conversation";
  time: string;
  icon: "database" | "code" | "chart";
}

interface KiChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KiChat({ isOpen, onClose }: KiChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Demo data
  const recentItems: RecentItem[] = [
    { id: "1", title: "Databaser og SQL", type: "presentation", time: "43 sekunder siden", icon: "database" },
    { id: "2", title: "React Hooks", type: "topic", time: "2 timer siden", icon: "code" },
    { id: "3", title: "Algoritmer", type: "conversation", time: "2 maneder siden", icon: "chart" },
  ];

  // Scroll detection for showing project cards
  useEffect(() => {
    const handleScroll = () => {
      if (mainContentRef.current) {
        const scrollTop = mainContentRef.current.scrollTop;
        setShowProjects(scrollTop > 50);
      }
    };

    const content = mainContentRef.current;
    if (content) {
      content.addEventListener("scroll", handleScroll);
      return () => content.removeEventListener("scroll", handleScroll);
    }
  }, []);

  // Auto-scroll to bottom when new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Takk for meldingen! Dette er en demo-respons. Du skrev: "${userMessage.content}"`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1000);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "database":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />;
      case "code":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
      case "chart":
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-white dark:bg-[#0a0a0a]">
      {/* Sidebar - Light/Dark mode support */}
      <aside
        className={`
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 fixed md:relative z-20 h-full w-56
          bg-gray-50 dark:bg-[#0a0a0a] border-r border-gray-200 dark:border-white/5
          flex flex-col transition-transform duration-300 ease-in-out
        `}
      >
        {/* Sidebar Header */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="font-medium text-gray-900 dark:text-white text-sm">StudyWise</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2">
          <div className="space-y-0.5">
            <button className="w-full flex items-center gap-2.5 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Hjem
            </button>
            <button className="w-full flex items-center gap-2.5 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Sok
            </button>
          </div>

          {/* Projects */}
          <div className="mt-6">
            <p className="px-3 text-[10px] font-medium text-gray-500 dark:text-gray-600 uppercase tracking-wider mb-1">Prosjekter</p>
            <div className="space-y-0.5">
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Nylige
              </button>
              {recentItems.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedTopic(item.title)}
                  className="w-full flex items-center px-3 py-1.5 pl-8 text-gray-500 dark:text-gray-600 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-xs text-left"
                >
                  {item.title}
                </button>
              ))}
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Alle prosjekter
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Favoritter
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Delt med meg
              </button>
            </div>
          </div>

          {/* Resources */}
          <div className="mt-6">
            <p className="px-3 text-[10px] font-medium text-gray-500 dark:text-gray-600 uppercase tracking-wider mb-1">Ressurser</p>
            <div className="space-y-0.5">
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                Utforsk
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
                Maler
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-1.5 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Laer
              </button>
            </div>
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="p-2 border-t border-gray-200 dark:border-white/5">
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-md transition-colors text-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Del StudyWise
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-10"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <main 
        ref={mainContentRef}
        className="flex-1 flex flex-col relative overflow-y-auto"
      >
        {/* Dynamic Animated Gradient Background - Light/Dark mode */}
        <div className="fixed inset-0 pointer-events-none md:left-56 overflow-hidden">
          {/* Base layer - light gradient or dark solid */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-blue-50 dark:from-[#0a0a0a] dark:via-[#0a0a0a] dark:to-[#0a0a0a]" />
          
          {/* Light mode: Soft violet/blue/pink pastels | Dark mode: Vivid colors */}
          
          {/* Orb 1: Light violet/purple - top left */}
          <div 
            className="absolute top-[-15%] left-[5%] w-[70%] h-[55%] rounded-full blur-3xl
                       opacity-65 dark:opacity-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(139, 92, 246, 0.7) 0%, rgba(124, 58, 237, 0.4) 40%, transparent 70%)",
              animation: "float1 8s ease-in-out infinite",
            }}
          />
          <div 
            className="absolute top-[-20%] left-[10%] w-[80%] h-[60%] rounded-full blur-3xl
                       opacity-0 dark:opacity-60"
            style={{
              background: "radial-gradient(ellipse at center, rgba(59, 130, 246, 0.5) 0%, transparent 70%)",
              animation: "float1 8s ease-in-out infinite",
            }}
          />
          
          {/* Orb 2: Light pink/rose - right side */}
          <div 
            className="absolute top-[15%] right-[-5%] w-[55%] h-[60%] rounded-full blur-3xl
                       opacity-60 dark:opacity-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(236, 72, 153, 0.6) 0%, rgba(219, 39, 119, 0.35) 40%, transparent 70%)",
              animation: "float2 10s ease-in-out infinite",
            }}
          />
          <div 
            className="absolute top-[20%] right-[-10%] w-[60%] h-[70%] rounded-full blur-3xl
                       opacity-0 dark:opacity-50"
            style={{
              background: "radial-gradient(ellipse at center, rgba(236, 72, 153, 0.6) 0%, transparent 70%)",
              animation: "float2 10s ease-in-out infinite",
            }}
          />
          
          {/* Orb 3: Light blue - bottom */}
          <div 
            className="absolute bottom-[-5%] left-[15%] w-[65%] h-[45%] rounded-full blur-3xl
                       opacity-55 dark:opacity-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(59, 130, 246, 0.65) 0%, rgba(37, 99, 235, 0.4) 40%, transparent 70%)",
              animation: "float3 12s ease-in-out infinite",
            }}
          />
          <div 
            className="absolute bottom-[-10%] left-[20%] w-[70%] h-[50%] rounded-full blur-3xl
                       opacity-0 dark:opacity-40"
            style={{
              background: "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.5) 0%, transparent 70%)",
              animation: "float3 12s ease-in-out infinite",
            }}
          />
          
          {/* Orb 4: Light violet accent - center */}
          <div 
            className="absolute top-[35%] left-[35%] w-[45%] h-[45%] rounded-full blur-3xl
                       opacity-50 dark:opacity-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(167, 139, 250, 0.7) 0%, rgba(139, 92, 246, 0.4) 40%, transparent 70%)",
              animation: "float4 9s ease-in-out infinite",
            }}
          />
          <div 
            className="absolute top-[40%] left-[40%] w-[40%] h-[40%] rounded-full blur-3xl
                       opacity-0 dark:opacity-30"
            style={{
              background: "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.4) 0%, transparent 70%)",
              animation: "float4 9s ease-in-out infinite",
            }}
          />
          
          {/* Orb 5: Extra light pink glow for light mode - top right */}
          <div 
            className="absolute top-[5%] right-[20%] w-[35%] h-[30%] rounded-full blur-3xl
                       opacity-45 dark:opacity-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(244, 114, 182, 0.55) 0%, transparent 70%)",
              animation: "float1 11s ease-in-out infinite reverse",
            }}
          />
          
          {/* Subtle noise overlay for texture */}
          <div 
            className="absolute inset-0 opacity-[0.02] dark:opacity-[0.015]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            }}
          />
        </div>

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-4 py-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 text-gray-500 dark:text-white/60 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-2 text-gray-500 dark:text-white/60 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors"
            aria-label="Lukk chat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col">
          {messages.length === 0 ? (
            <>
              {/* Hero Section - Centered */}
              <div className="flex-1 flex flex-col items-center justify-center px-4 min-h-[60vh]">
                <h1 className="text-3xl sm:text-4xl font-semibold text-gray-800 dark:text-white mb-8 text-center">
                  {selectedTopic ? `Spør om ${selectedTopic}?` : "Har du et spørsmål?"}
                </h1>

                {/* Input Box */}
                <div className="w-full max-w-2xl">
                  <div className="bg-white dark:bg-[#1a1a1f] rounded-3xl border border-gray-200/60 dark:border-white/10 shadow-xl dark:shadow-2xl overflow-hidden">
                    <div className="px-4 py-3">
                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={selectedTopic ? `Spør StudyWise om ${selectedTopic}...` : "Spør StudyWise om et emne..."}
                        rows={1}
                        className="w-full bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none outline-none text-sm"
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-white/5">
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        <button className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          Vedlegg
                        </button>
                        <button className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                          </svg>
                          Tema
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button className="px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl transition-colors">
                          Plan
                        </button>
                        <button className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </button>
                        <button
                          onClick={handleSubmit}
                          disabled={!input.trim() || isLoading}
                          className="p-1.5 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-200 dark:disabled:bg-white/5 disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-full transition-all"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Section - Project Cards (appears on scroll) */}
              <div 
                className={`
                  px-4 pb-6 pt-8 bg-gray-50 dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-white/5
                  transition-all duration-300 ease-out
                  ${showProjects ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
                `}
              >
                {/* Tabs */}
                <div className="max-w-4xl mx-auto mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button className="px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-white bg-gray-200 dark:bg-white/10 rounded-xl">
                        Nylig vist
                      </button>
                      <button className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors">
                        Mine prosjekter
                      </button>
                      <button className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors">
                        Maler
                      </button>
                    </div>
                    <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">
                      Bla gjennom alle
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Cards */}
                <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recentItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedTopic(item.title)}
                      className="group text-left bg-white dark:bg-[#141417] hover:bg-gray-50 dark:hover:bg-[#1a1a1f] border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 rounded-2xl overflow-hidden transition-all shadow-sm"
                    >
                      <div className="aspect-[16/10] bg-gray-100 dark:bg-[#1a1a1f] flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-300 dark:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {getIcon(item.icon)}
                        </svg>
                      </div>
                      <div className="p-3 flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-xs font-medium shrink-0">
                          S
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 dark:text-white text-sm font-medium truncate">{item.title}</p>
                          <p className="text-gray-400 dark:text-gray-600 text-xs">Sett {item.time}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Scroll indicator */}
              {!showProjects && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-400 dark:text-gray-600 animate-bounce">
                  <span className="text-xs">Bla ned for tidligere chatter</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              )}
            </>
          ) : (
            /* Messages View */
            <div className="flex-1 px-4 py-6">
              <div className="max-w-3xl mx-auto space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-3 rounded-3xl ${
                        message.role === "user"
                          ? "bg-purple-600 text-white"
                          : "bg-white dark:bg-[#1a1a1f] text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-white/5 shadow-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed text-sm">{message.content}</p>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-[#1a1a1f] border border-gray-200 dark:border-white/5 px-4 py-3 rounded-3xl shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Input Footer when messages exist */}
        {messages.length > 0 && (
          <footer className="relative z-10 px-4 py-3 bg-gray-50 dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-white/5 shrink-0">
            <div className="max-w-3xl mx-auto">
              <div className="bg-white dark:bg-[#1a1a1f] rounded-2xl border border-gray-200/60 dark:border-white/10 overflow-hidden shadow-sm">
                <div className="flex items-end gap-2 px-3 py-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Skriv en melding..."
                    rows={1}
                    className="flex-1 bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none outline-none text-sm"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || isLoading}
                    className="p-1.5 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-200 dark:disabled:bg-white/5 disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-full transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}

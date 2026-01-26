/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 */
"use client";

import { useState } from "react";
import { CanvasSection } from "../components/canvasSection";
import { KISection } from "../components/kiSection";

// Dashboard side komponent
export default function DashboardPage() {
  const [activeView, setActiveView] = useState<"overview" | "canvas" | "ki">("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Meny elementer
  const menuItems = [
    { id: "overview" as const, label: "Oversikt", mobileLabel: "Oversikt" },
    { id: "canvas" as const, label: "Canvas", mobileLabel: "Canvas" },
    { id: "ki" as const, label: "KI Assistent", mobileLabel: "KI" },
  ];

  // Håndterer meny logikk
  const handleMenuClick = (view: "overview" | "canvas" | "ki") => {
    setActiveView(view);
    setSidebarOpen(false); // Lukk sidebar på mobil etter valg
  };

  // Render Dashboard
  return (
    <div className="h-full flex flex-col md:flex-row dark:bg-black dark:text-gray-100">
      {/* Mobile Header */}
      <div className="md:hidden bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold">Dashboard</h1>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded"
          aria-label="Toggle menu"
        >
          {sidebarOpen ? "Lukk" : "Meny"}
        </button>
      </div>

      {/* Sidebar / Meny */}
      <aside
        className={`
          ${sidebarOpen ? "block" : "hidden"} md:block
          md:w-64 border-r dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-col p-4 gap-2
          absolute md:relative z-10 w-full md:h-auto h-auto
          shadow-lg md:shadow-none
        `}
      >
        <h1 className="text-xl font-bold mb-6 px-2 hidden md:block">Dashboard</h1>

        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleMenuClick(item.id)}
            className={`text-left px-4 py-3 rounded transition-colors ${activeView === item.id
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-semibold"
              : "hover:bg-gray-200 dark:hover:bg-gray-800"
              }`}
          >
            <span className="hidden md:inline">{item.label}</span>
            <span className="md:hidden">{item.label}</span>
          </button>
        ))}
      </aside>

      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-0"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content Area - Midtstilt */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 flex items-center justify-center overflow-auto">
        <div className="w-full max-w-4xl">
          {activeView === "overview" && (
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">Velkommen tilbake!</h2>
              <p className="text-gray-600 dark:text-gray-300 text-base sm:text-lg">
                Velg en modul fra menyen{" "}
                <span className="md:inline hidden">til venstre</span>
                <span className="md:hidden inline">over</span> for å komme i gang.
              </p>

              <div className="mt-8">
                <button
                  onClick={async () => {
                    try {
                      // Bruker relativ URL - Next.js rewrite vil sende dette til backend
                      const res = await fetch("/health");
                      const data = await res.json();
                      if (typeof window !== "undefined") {
                        window.alert(`Health Check: ${JSON.stringify(data, null, 2)}`);
                      }
                    } catch (err) {
                      if (typeof window !== "undefined") {
                        window.alert("Health Check Failed: " + err);
                      }
                    }
                  }}
                  className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
                >
                  Test Health
                </button>
              </div>
            </div>
          )}

          {activeView === "canvas" && <CanvasSection />}

          {activeView === "ki" && <KISection />}
        </div>
      </main>
    </div>
  );
}

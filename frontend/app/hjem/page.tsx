/*
 * Hjemmeside - Velkomstside for applikasjonen
 * Startpunkt i brukerflyten: Hjem → Dashboard/Auth
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import KiChat from "../components/kiChat";

export default function Hjem() {
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <>
      <div className="h-full flex flex-col items-center justify-center px-4 bg-gradient-to-b from-gray-50 via-white to-gray-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {/* Hero-seksjon */}
        <div className="text-center max-w-2xl mx-auto">
          {/* Logo/Ikon */}
          <div className="w-20 h-20 mx-auto mb-8 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 dark:text-white mb-4">
            StudyWise
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 dark:text-slate-400 mb-10">
            Din AI-drevne studieassistent for hoyere utdanning
          </p>

          {/* Handlingsknapper */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => setIsChatOpen(true)}
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all text-base sm:text-lg"
            >
              Start ny samtale
            </button>
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 text-gray-900 dark:text-white font-semibold rounded-xl border border-gray-200 dark:border-slate-700/50 hover:border-gray-300 dark:hover:border-slate-600/50 transition-all text-base sm:text-lg text-center"
            >
              Ga til Dashboard
            </Link>
          </div>
        </div>

        {/* Feature-kort */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 max-w-3xl mx-auto w-full">
          {[
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              ),
              title: "Smart AI",
              desc: "Fa hjelp med vanskelige emner",
            },
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              ),
              title: "Canvas-integrasjon",
              desc: "Synkroniser med dine emner",
            },
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              ),
              title: "Lynrask",
              desc: "Opp til 10x raskere laering",
            },
          ].map((feature, i) => (
            <div
              key={i}
              className="p-5 bg-white/80 dark:bg-slate-800/30 border border-gray-200 dark:border-slate-700/30 rounded-xl text-center hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors shadow-sm"
            >
              <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-violet-600 dark:text-violet-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {feature.icon}
                </svg>
              </div>
              <h3 className="text-gray-900 dark:text-white font-medium mb-1">{feature.title}</h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KI Chat */}
      <KiChat isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
    </>
  );
}

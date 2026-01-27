/*
 * Hjemmeside - Velkomstside for applikasjonen
 * Startpunkt i brukerflyten: Hjem → Dashboard/Auth
 */
"use client";

import Link from "next/link";
import { Footer } from "../components/footer";

export default function Hjem() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center">StudyWise</h1>
        <Link
          href="/dashboard"
          className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm sm:text-base"
        >
          Gå til Dashboard
        </Link>
      </div>
      <Footer />
    </div>
  );
}

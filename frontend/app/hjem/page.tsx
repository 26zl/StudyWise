/*
 * Hjemmeside - Velkomstside for applikasjonen
 * Startpunkt i brukerflyten: Hjem → Dashboard/Auth
 */
"use client";

import Link from "next/link";

export default function Hjem() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center">Bachelor IT</h1>
      <Link
        href="/dashboard"
        className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm sm:text-base"
      >
        Gå til Dashboard
      </Link>
    </div>
  );
}

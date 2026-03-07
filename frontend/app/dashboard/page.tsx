/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= styres av nuqs i DashboardView
 */
"use client";

import { DashboardView } from "../components/DashboardView";

export default function DashboardPage() {
    return <DashboardView />;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useUIStore } from "../store/uiStore";

export function Header() {
    const pathname = usePathname();
    const { toggleSidebar } = useUIStore();
    const isDashboard = pathname === "/dashboard";

    return (
        <header className="shrink-0 h-14 px-4 md:px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 sticky top-0 z-30">
            <div className="flex items-center gap-3">
                {isDashboard && (
                    <button
                        onClick={toggleSidebar}
                        className="md:hidden p-1 -ml-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                        aria-label="Toggle menu"
                    >
                        <Menu size={24} />
                    </button>
                )}
                <div className="font-semibold text-lg text-slate-900 dark:text-white">
                    <Link href="/hjem">StudyWise</Link>
                </div>
            </div>
            <nav className="flex gap-6 text-sm text-slate-600 dark:text-slate-400">
                <Link href="/hjem" className="hover:text-slate-900 dark:hover:text-white transition-colors">Hjem</Link>
                <Link href="/dashboard" className="hover:text-slate-900 dark:hover:text-white transition-colors">Dashboard</Link>
                <Link href="/auth" className="hover:text-slate-900 dark:hover:text-white transition-colors">Logg inn</Link>
            </nav>
        </header>
    );
}

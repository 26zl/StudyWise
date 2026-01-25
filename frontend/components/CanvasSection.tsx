/*
* Kun ment for testing
* Må endres
*/


"use client";

import { useCanvasAnnouncements, useCanvasEmner } from "../app/canvas/canvas-api";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { useState } from "react";
import DOMPurify from "isomorphic-dompurify";

export function CanvasSection() {
    // Vi laster data umiddelbart (prefetch) for raskere visning, men viser det ikke før brukeren velger
    const announcementsQuery = useCanvasAnnouncements();
    const emnerQuery = useCanvasEmner();
    const [activeTab, setActiveTab] = useState<"menu" | "announcements" | "courses">("menu");

    if (activeTab === "menu") {
        return (
            <div className="w-full">
                <h2 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-white">Hva vil du se?</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <button
                        onClick={() => setActiveTab("announcements")}
                        className="p-8 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all flex flex-col items-center gap-4 group"
                    >
                        <span className="text-4xl group-hover:scale-110 transition-transform duration-200"></span>
                        <span className="text-xl font-bold text-gray-800 dark:text-gray-100">Kunngjøringer</span>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">Siste nytt fra dine emner</p>
                    </button>

                    <button
                        onClick={() => setActiveTab("courses")}
                        className="p-8 border rounded-lg bg-gray-50 dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all flex flex-col items-center gap-4 group"
                    >
                        <span className="text-4xl group-hover:scale-110 transition-transform duration-200"></span>
                        <span className="text-xl font-bold text-gray-800 dark:text-gray-100">Mine Emner</span>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">Oversikt over fagopplegg</p>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            <button
                onClick={() => setActiveTab("menu")}
                className="mb-6 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
            >
                ← Tilbake til valg
            </button>

            {/* Tabs - Responsive */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-6">
                <button
                    onClick={() => setActiveTab("announcements")}
                    className={`px-4 py-3 sm:py-2 rounded font-semibold transition-colors ${activeTab === "announcements"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                >
                    <span className="sm:hidden">Kunngjøringer</span>
                    <span className="hidden sm:inline">Kunngjøringer</span>
                </button>

                <button
                    onClick={() => setActiveTab("courses")}
                    className={`px-4 py-3 sm:py-2 rounded font-semibold transition-colors ${activeTab === "courses"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                >
                    <span className="sm:hidden">Mine Emner</span>
                    <span className="hidden sm:inline">Mine Emner</span>
                </button>
            </div>

            {/* Announcements Tab */}
            {activeTab === "announcements" && (
                <div className="space-y-4">
                    {announcementsQuery.isLoading && (
                        <p className="text-center text-gray-500 dark:text-gray-400 py-8">Laster kunngjøringer...</p>
                    )}
                    {announcementsQuery.data?.announcements.map((announcement) => (
                        <div key={announcement.id} className="p-4 sm:p-5 border rounded-lg shadow-sm bg-white dark:bg-gray-900 dark:border-gray-700 transition-colors">
                            <h3 className="font-bold text-base sm:text-lg mb-1 wrap-break-word text-gray-900 dark:text-gray-100">
                                {announcement.title}
                            </h3>
                            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-2">
                                {announcement.posted_at &&
                                    formatDistanceToNow(new Date(announcement.posted_at), {
                                        addSuffix: true,
                                        locale: nb,
                                    })}
                            </p>
                            {announcement.message && (
                                <div
                                    className="prose prose-sm max-w-none wrap-break-word dark:prose-invert"
                                    dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(announcement.message),
                                    }}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Courses Tab */}
            {activeTab === "courses" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 sm:gap-4">
                    {emnerQuery.isLoading && (
                        <p className="col-span-full text-center text-gray-500 dark:text-gray-400 py-8">Laster emner...</p>
                    )}
                    {emnerQuery.data?.emner.map((emne) => (
                        <div key={emne.id} className="p-4 sm:p-5 border rounded-lg shadow-sm bg-white hover:shadow-md transition-all dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800">
                            <h3 className="font-bold text-base sm:text-lg wrap-break-word text-gray-900 dark:text-gray-100">{emne.name}</h3>
                            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">{emne.course_code}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

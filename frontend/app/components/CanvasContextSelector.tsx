"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { useCanvasAnnouncements, useCanvasCourses } from "../canvas/canvas-api";

interface CanvasContextSelectorProps {
  onContextChange: (context: string) => void;
}

export function CanvasContextSelector({ onContextChange }: CanvasContextSelectorProps) {
  const [selected, setSelected] = useState({
    announcements: true,
    courses: true,
    assignments: false,
  });

  const { data: announcementsData } = useCanvasAnnouncements();
  const { data: coursesData } = useCanvasCourses();

  // Bygg context string når bruker endrer valg
  useEffect(() => {
    let context = "";

    if (selected.announcements && announcementsData?.announcements) {
      context += "\n\nKUNNGJØRINGER:\n";
      announcementsData.announcements.slice(0, 5).forEach((a) => {
        context += `- ${a.title}\n`;
      });
    }

    if (selected.courses && coursesData?.courses) {
      context += "\n\nEMNER:\n";
      coursesData.courses.slice(0, 10).forEach((c) => {
        context += `- ${c.name} (${c.course_code})\n`;
      });
    }

    onContextChange(context);
  }, [selected, announcementsData, coursesData, onContextChange]);

  const toggleOption = (key: keyof typeof selected) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const options = [
    {
      key: "announcements" as const,
      label: "Kunngjøringer",
      count: announcementsData?.announcements?.length || 0,
      description: "Nyeste kunngjøringer fra dine emner",
    },
    {
      key: "courses" as const,
      label: "Emner",
      count: coursesData?.courses?.length || 0,
      description: "Dine aktive emner",
    },
    {
      key: "assignments" as const,
      label: "Oppgaver",
      count: 0,
      description: "Kommende innleveringer (kommer snart)",
      disabled: true,
    },
  ];

  return (
    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
        Gi AI tilgang til:
      </h3>
      <div className="space-y-2">
        {options.map((option) => (
          <button
            key={option.key}
            onClick={() => !option.disabled && toggleOption(option.key)}
            disabled={option.disabled}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-colors ${
              selected[option.key]
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            } ${
              option.disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-blue-400 cursor-pointer"
            }`}
          >
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                selected[option.key]
                  ? "border-blue-500 bg-blue-500"
                  : "border-slate-300 dark:border-slate-600"
              }`}
            >
              {selected[option.key] && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {option.label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  ({option.count})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {option.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
} 
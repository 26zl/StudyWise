"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { useCanvasAnnouncements, useCanvasCourses, useCanvasTodo } from "../canvas/canvas-api";

interface CanvasContextSelectorProps {
  onContextChange: (context: string) => void;
  onContextStateChange?: (hasContext: boolean) => void;
}

export function CanvasContextSelector({ onContextChange, onContextStateChange }: CanvasContextSelectorProps) {
  const [selected, setSelected] = useState({
    announcements: true,
    courses: true,
    assignments: true,
  });

  const { data: announcementsData } = useCanvasAnnouncements();
  const { data: coursesData } = useCanvasCourses();
  const { data: todoData } = useCanvasTodo(selected.assignments);

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

    if (selected.assignments && todoData?.todos) {
      context += "\n\nOPPGAVER/TODO (fra Canvas):\n";
      todoData.todos.slice(0, 5).forEach((t) => {
        const navn = t.assignment?.name || t.quiz?.title || t.type || "Item";
        const frist = t.assignment?.due_at || t.quiz?.due_at;
        const fristStr = frist ? new Date(frist).toLocaleDateString("no-NO") : "";
        context += `- ${navn}${fristStr ? ` (frist ${fristStr})` : ""}\n`;
      });
    }

    onContextChange(context);
    onContextStateChange?.(context.trim().length > 0);
  }, [selected, announcementsData, coursesData, todoData, onContextChange]);

  const toggleOption = (key: keyof typeof selected) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Hjelpetekst når alt er av
  const allOff =
    !selected.announcements &&
    !selected.courses &&
    !selected.assignments;

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
      count: todoData?.todos?.length || 0,
      description: "Kommende innleveringer/todo fra Canvas",
      disabled: false,
    },
  ];

  return (
    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
        Gi AI tilgang til:
      </h3>
      {allOff && (
        <div className="mb-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded">
          Ingen data valgt. AI kan ikke svare på Canvas-spørsmål før du huker av minst ett datasett.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            onClick={() => !option.disabled && toggleOption(option.key)}
            disabled={option.disabled}
            className={`flex flex-col items-start gap-2 p-3 rounded-lg border transition-colors ${
              selected[option.key]
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            } ${
              option.disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-blue-400 cursor-pointer"
            }`}
          >
            <div className="flex items-center gap-2 w-full">
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                  selected[option.key]
                    ? "border-blue-500 bg-blue-500"
                    : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {selected[option.key] && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {option.label}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ({option.count})
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
} 

/*
 * WeeklyPlanSuggestions - KI-generert ukeplan basert på Canvas-oppgaver
 * Analyserer oppgaver og frister, foreslår optimal studieukeplan
 */
"use client";

import { useState } from "react";
import { Calendar, Sparkles, Loader2, Check, Clock, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { getWeekNumber } from "common/dateUtils";

// Typer for oppgaver og studieblokker
interface Assignment {
    id: string;
    name: string;
    dueAt?: string;
    courseName?: string;
    description?: string;
    pointsPossible?: number;
}

// Studieblokk i ukeplanen
interface StudyBlock {
    day: string;
    timeSlot: string;
    task: string;
    duration: string;
    priority: "high" | "medium" | "low";
    courseName: string;
}
// Struktur for ukeplanen
interface WeeklyPlan {
    week: string;
    totalHours: number;
    blocks: StudyBlock[];
    tips: string[];
}
// Props for WeeklyPlanSuggestions-komponenten
interface WeeklyPlanSuggestionsProps {
    assignments: Assignment[];
    onAddToCalendar?: (block: StudyBlock) => void;
}

// Fargemapping for prioritet
const PRIORITY_COLORS = {
    high: "bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
    medium: "bg-yellow-100 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300",
    low: "bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300",
};

// Dager på norsk for visning
const DAYS_NORWEGIAN = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

// Hovedkomponent for å vise KI-genererte ukeplanforslag basert på Canvas-oppgaver
export function WeeklyPlanSuggestions({ assignments, onAddToCalendar }: WeeklyPlanSuggestionsProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Generer ukeplan med KI (MOCK - erstatt med ekte API)
    const generateWeeklyPlan = async () => {
        setIsGenerating(true);
        setError(null);

        // MOCK DATA - i produksjon, send til backend som kaller HuggingFace/OpenAI
        setTimeout(() => {
            // Sorter oppgaver etter frist
            const sortedAssignments = [...assignments]
                .filter(a => a.dueAt)
                .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
                .slice(0, 5); // Ta de 5 nærmeste fristene

            if (sortedAssignments.length === 0) {
                setError("Ingen oppgaver med frister funnet. Legg til oppgaver i Canvas først.");
                setIsGenerating(false);
                return;
            }

            // Generer studieblokker
            const blocks: StudyBlock[] = [];
            const timeSlots = ["08:00-10:00", "10:00-12:00", "13:00-15:00", "15:00-17:00", "17:00-19:00"];
            
            sortedAssignments.forEach((assignment, index) => {
                const daysUntilDue = Math.ceil((new Date(assignment.dueAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const priority: "high" | "medium" | "low" = daysUntilDue <= 3 ? "high" : daysUntilDue <= 7 ? "medium" : "low";
                
                // Fordel over uken
                const dayIndex = index % 5; // Mandag-Fredag
                const timeSlotIndex = Math.floor(index / 5) % timeSlots.length;

                blocks.push({
                    day: DAYS_NORWEGIAN[dayIndex],
                    timeSlot: timeSlots[timeSlotIndex],
                    task: assignment.name,
                    duration: priority === "high" ? "2 timer" : "1.5 timer",
                    priority,
                    courseName: assignment.courseName || "Ukjent emne",
                });
            });

            // Generer tips
            const tips = [
                "Start med høyprioritet oppgaver tidlig på dagen når du er mest våken",
                "Ta pauser hver time for å bevare konsentrasjonen",
                "Bruk Pomodoro-teknikk (25 min fokus, 5 min pause) for effektiv studietid",
                `Du har ${sortedAssignments.filter(a => {
                    const days = Math.ceil((new Date(a.dueAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    return days <= 3;
                }).length} oppgaver med frist innen 3 dager - prioriter disse først!`,
            ];

            const totalHours = blocks.reduce((sum, block) => {
                const hours = parseFloat(block.duration.split(" ")[0]);
                return sum + hours;
            }, 0);

            setWeeklyPlan({
                week: `Uke ${getWeekNumber(new Date())}`,
                totalHours,
                blocks,
                tips,
            });
            setIsExpanded(true);
            setIsGenerating(false);
        }, 2000);
    };

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => {
                    if (!weeklyPlan) {
                        generateWeeklyPlan();
                    } else {
                        setIsExpanded(!isExpanded);
                    }
                }}
                disabled={isGenerating || assignments.length === 0}
                className="w-full p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-slate-900 dark:text-white">
                            KI-forslag til ukeplan
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {isGenerating
                                ? "Genererer personlig ukeplan..."
                                : weeklyPlan
                                ? `${weeklyPlan.totalHours} timer fordelt over uken`
                                : `Basert på ${assignments.length} oppgaver`}
                        </p>
                    </div>
                </div>
                {isGenerating ? (
                    <Loader2 className="w-5 h-5 text-purple-600 dark:text-purple-400 animate-spin" />
                ) : weeklyPlan ? (
                    isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                    )
                ) : (
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                )}
            </button>

            {/* Error */}
            {error && (
                <div className="px-4 pb-4">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                    </div>
                </div>
            )}

            {/* Weekly Plan */}
            {weeklyPlan && isExpanded && (
                <div className="border-t border-slate-200 dark:border-slate-700">
                    {/* Tips */}
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-200 dark:border-blue-800">
                        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2 flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            KI-tips for effektiv studie
                        </h4>
                        <ul className="space-y-1">
                            {weeklyPlan.tips.map((tip, index) => (
                                <li key={index} className="text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{tip}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Study Blocks by Day */}
                    <div className="p-4 space-y-3">
                        {DAYS_NORWEGIAN.map((day) => {
                            const dayBlocks = weeklyPlan.blocks.filter((b) => b.day === day);
                            if (dayBlocks.length === 0) return null;

                            return (
                                <div key={day} className="space-y-2">
                                    <h5 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-slate-400" />
                                        {day}
                                    </h5>
                                    <div className="space-y-2 pl-6">
                                        {dayBlocks.map((block, index) => (
                                            <div
                                                key={index}
                                                className={`p-3 rounded-lg border ${PRIORITY_COLORS[block.priority]}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <Clock className="w-4 h-4 shrink-0" />
                                                            <span className="font-semibold text-sm">
                                                                {block.timeSlot}
                                                            </span>
                                                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/50 dark:bg-black/20">
                                                                {block.duration}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm font-medium mb-1 truncate">
                                                            {block.task}
                                                        </p>
                                                        <p className="text-xs opacity-75">
                                                            {block.courseName}
                                                        </p>
                                                    </div>
                                                    {onAddToCalendar && (
                                                        <button
                                                            onClick={() => onAddToCalendar(block)}
                                                            className="shrink-0 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-black/20 transition-colors"
                                                            title="Legg til i kalender"
                                                        >
                                                            <Calendar className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Summary */}
                    <div className="px-4 pb-4">
                        <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-700/50">
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                <strong className="text-slate-900 dark:text-white">
                                    Total studietid:
                                </strong>{" "}
                                {weeklyPlan.totalHours} timer fordelt over{" "}
                                {weeklyPlan.blocks.length} studieøkter
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


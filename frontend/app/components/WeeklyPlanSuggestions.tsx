/*
 * WeeklyPlanSuggestions - OPPDATERT MED GODKJENN-FUNKSJONALITET
 * Nå med mulighet til å godkjenne og lagre KI-forslag som faktiske arbeidsoppgaver
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Calendar, 
  Sparkles, 
  Check, 
  Clock, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp,
  Plus,
  CheckCircle,
  Loader2
} from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { getWeekNumber } from "common/dateUtils";
import { useCreateArbeidsplan, type StudyBlock } from "../arbeidsplan/arbeidsplan-api";

// Typer
interface Assignment {
  id: string;
  name: string;
  dueAt?: string;
  courseName?: string;
  description?: string;
  pointsPossible?: number;
}

interface WeeklyPlan {
  week: string;
  totalHours: number;
  blocks: StudyBlock[];
  tips: string[];
}

interface WeeklyPlanSuggestionsProps {
  assignments: Assignment[];
  onPlanCreated?: () => void;
}

const PRIORITY_COLORS = {
  high: "bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
  medium: "bg-yellow-100 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300",
  low: "bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300",
};

const DAYS_ORDER = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

export function WeeklyPlanSuggestions({ assignments, onPlanCreated }: WeeklyPlanSuggestionsProps) {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const abortController = useRef<AbortController | null>(null);
  
  const createMutation = useCreateArbeidsplan();

  // Generate plan (MOCK - replace with real AI later)
  const generatePlan = async () => {
    setIsGenerating(true);
    setError(null);
    setPlan(null);
    setSelectedBlocks(new Set());

    abortController.current = new AbortController();

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (abortController.current?.signal.aborted) return;

      const now = new Date();
      const weekNum = getWeekNumber(now);
      const year = now.getFullYear();

      const blocks: StudyBlock[] = [];
      const assignmentsWithDates = assignments.filter((a) => a.dueAt);

      assignmentsWithDates.forEach((assignment) => {
        if (!assignment.dueAt) return;

        const dueDate = new Date(assignment.dueAt);
        const today = new Date();
        const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntilDue < 0 || daysUntilDue > 14) return;

        const priority: "high" | "medium" | "low" = 
          daysUntilDue <= 3 ? "high" : daysUntilDue <= 7 ? "medium" : "low";

        const dayIndex = Math.max(0, Math.min(4, Math.floor(daysUntilDue / 3)));
        const day = DAYS_ORDER[dayIndex];
        const hour = 8 + (blocks.filter((b) => b.day === day).length * 2);
        const timeSlot = `${hour.toString().padStart(2, "0")}:00-${(hour + 2).toString().padStart(2, "0")}:00`;

        blocks.push({
          day,
          timeSlot,
          task: assignment.name,
          duration: priority === "high" ? "2 timer" : "1.5 timer",
          priority,
          courseName: assignment.courseName || "Emne",
          assignmentId: assignment.id,
          completed: false,
        });
      });

      setPlan({
        week: `Uke ${weekNum}, ${year}`,
        totalHours: blocks.length * 1.75,
        blocks,
        tips: [
          "Start med høyprioriteringsoppgaver først på dagen",
          "Ta korte pauser hver time",
          "Planlegg buffer-tid for uforutsette ting",
        ],
      });
    } catch (err) {
      setError("Kunne ikke generere ukeplan. Prøv igjen.");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleBlockSelection = (index: number) => {
    const newSet = new Set(selectedBlocks);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedBlocks(newSet);
  };

  const selectAll = () => {
    if (!plan) return;
    setSelectedBlocks(new Set(plan.blocks.map((_, i) => i)));
  };

  const deselectAll = () => {
    setSelectedBlocks(new Set());
  };

  const handleSavePlan = async () => {
    if (!plan || selectedBlocks.size === 0) return;

    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const year = now.getFullYear();

    const selectedBlocksArray = plan.blocks.filter((_, i) => selectedBlocks.has(i));

    try {
      await createMutation.mutateAsync({
        week: plan.week,
        weekNumber,
        year,
        blocks: selectedBlocksArray,
        totalHours: selectedBlocksArray.length * 1.75,
      });

      // Success!
      onPlanCreated?.();
      
      // Reset
      setPlan(null);
      setSelectedBlocks(new Set());
    } catch (error) {
      setError("Kunne ikke lagre arbeidsplan. Prøv igjen.");
    }
  };

  useEffect(() => {
    return () => {
      abortController.current?.abort();
    };
  }, []);

  if (!plan && !isGenerating && !error) {
    return (
      <div className="rounded-xl border-2 border-dashed border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/20 p-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30">
            <Sparkles className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              KI Ukeplangenerator
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
              La KI analysere dine Canvas-oppgaver og lage en optimal studieukeplan.
              Du kan deretter velge hvilke studieblokker du vil legge til i din arbeidsplan.
            </p>
            <button
              onClick={generatePlan}
              disabled={assignments.length === 0}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Generer ukeplan
            </button>
            {assignments.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                Ingen oppgaver funnet. Legg til oppgaver i Canvas først.
              </p>
            )}
          </div>
        </div>
      </div>
    ); 
  }

  if (isGenerating) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-12">
        <div className="text-center space-y-4">
          <LoadingSpinner className="w-12 h-12" />  
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Genererer ukeplan...
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              KI analyserer dine oppgaver og frister
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
        <button
          onClick={generatePlan}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  if (!plan) return null;

  const blocksByDay = plan.blocks.reduce((acc, block, index) => {
    if (!acc[block.day]) acc[block.day] = [];
    acc[block.day].push({ ...block, index });
    return acc;
  }, {} as Record<string, (StudyBlock & { index: number })[]>);

  const sortedDays = Object.keys(blocksByDay).sort(
    (a, b) => DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b)
  );

  const allSelected = selectedBlocks.size === plan.blocks.length;
  const someSelected = selectedBlocks.size > 0 && selectedBlocks.size < plan.blocks.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                KI-generert ukeplan
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {plan.week} • {plan.totalHours} timer totalt
            </p>
          </div>
          <button
            onClick={generatePlan}
            className="px-4 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
          >
            Regenerer
          </button>
        </div>

        {/* Selection controls */}
        <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <button
              onClick={allSelected ? deselectAll : selectAll}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                allSelected
                  ? "bg-purple-600 border-purple-600"
                  : someSelected
                  ? "bg-purple-300 border-purple-600"
                  : "border-slate-300 dark:border-slate-600"
              }`}
            >
              {allSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
              {someSelected && !allSelected && (
                <div className="w-2 h-2 bg-purple-600 rounded-sm" />
              )}
            </button>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {selectedBlocks.size === 0
                ? "Velg studieblokker å legge til"
                : `${selectedBlocks.size} valgt`}
            </span>
          </div>
          
          <button
            onClick={handleSavePlan}
            disabled={selectedBlocks.size === 0 || createMutation.isPending}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Lagrer...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Legg til i min plan
              </>
            )}
          </button>
        </div>

        {createMutation.isSuccess && (
          <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Arbeidsplan lagret! Se den under "Min arbeidsplan".
            </p>
          </div>
        )}
      </div>

      {/* Study blocks by day */}
      <div className="space-y-3">
        {sortedDays.map((day) => {
          const dayBlocks = blocksByDay[day];
          const isExpanded = expandedDay === day;

          return (
            <div
              key={day}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden"
            >
              <button
                onClick={() => setExpandedDay(isExpanded ? null : day)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-400" />
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {day}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {dayBlocks.length} oppgaver
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {dayBlocks.map((block) => (
                    <div
                      key={block.index}
                      className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleBlockSelection(block.index)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            selectedBlocks.has(block.index)
                              ? "bg-purple-600 border-purple-600"
                              : "border-slate-300 dark:border-slate-600 hover:border-purple-600"
                          }`}
                        >
                          {selectedBlocks.has(block.index) && (
                            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                          )}
                        </button>

                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <h4 className="font-medium text-sm text-slate-900 dark:text-white mb-1">
                                {block.task}
                              </h4>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {block.courseName}
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${PRIORITY_COLORS[block.priority]}`}>
                              {block.priority === "high" ? "Høy" : block.priority === "medium" ? "Medium" : "Lav"}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {block.timeSlot}
                            </div>
                            <div>⏱ {block.duration}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tips */}
      {plan.tips && plan.tips.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-4">
          <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-300 mb-2">
            💡 Tips fra KI
          </h4>
          <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
            {plan.tips.map((tip, i) => (
              <li key={i}>• {tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}   
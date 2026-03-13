/*
 * WeeklyPlanSuggestions
 * - Dedikert backend-generering via /api/ki/weekly-plan
 * - Checkbox selection av studieblokker
 * - Lagring til arbeidsplan
 * - Success feedback
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";
import { parseTimerStreng } from "common/dateUtils";
import type {
  WeeklyPlanAssignment,
  WeeklyPlanSuggestionResponse,
} from "common/ki";
import { LoadingSpinner } from "./LoadingSpinner";
import { showToast } from "./Toaster";
import {
  DAYS_ORDER,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  useCreateArbeidsplan,
  type StudyBlock,
} from "../arbeidsplan/arbeidsplan-api";
import { useGenerateWeeklyPlan } from "../ki/ki-api";

interface WeeklyPlanSuggestionsProps {
  assignments: WeeklyPlanAssignment[];
  onPlanCreated?: () => void;
}

function beregnTimer(blocks: StudyBlock[]): number {
  return blocks.reduce((sum, block) => {
    const hours = parseTimerStreng(block.duration);
    return sum + (hours > 0 ? hours : 1.5);
  }, 0);
}

export function WeeklyPlanSuggestions({
  assignments,
  onPlanCreated,
}: WeeklyPlanSuggestionsProps) {
  const [plan, setPlan] = useState<WeeklyPlanSuggestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const isMountedRef = useRef(true);

  const generateWeeklyPlan = useGenerateWeeklyPlan();
  const createMutation = useCreateArbeidsplan();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const generatePlan = () => {
    setError(null);
    setPlan(null);
    setSelectedBlocks(new Set());

    const sortedAssignments = [...assignments]
      .filter((a): a is WeeklyPlanAssignment & { dueAt: NonNullable<WeeklyPlanAssignment["dueAt"]> } => !!a.dueAt)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 20);

    if (sortedAssignments.length === 0) {
      if (isMountedRef.current) {
        setError("Ingen oppgaver med frister funnet. Legg til oppgaver i Canvas først.");
      }
      return;
    }

    generateWeeklyPlan.mutate(
      { assignments: sortedAssignments },
      {
        onSuccess: (data) => {
          if (!isMountedRef.current) return;
          setPlan(data);
          showToast.success(
            `KI-assistenten genererte en ukeplan med ${data.blocks.length} studieøkter!`,
          );
        },
        onError: (mutationError) => {
          if (!isMountedRef.current) return;
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "KI-generering feilet. Sjekk at du har oppgaver med frister i Canvas.",
          );
        },
      },
    );
  };

  const toggleBlockSelection = (index: number) => {
    const nextSet = new Set(selectedBlocks);
    if (nextSet.has(index)) {
      nextSet.delete(index);
    } else {
      nextSet.add(index);
    }
    setSelectedBlocks(nextSet);
  };

  const selectAll = () => {
    if (!plan) return;
    setSelectedBlocks(new Set(plan.blocks.map((_, index) => index)));
  };

  const deselectAll = () => {
    setSelectedBlocks(new Set());
  };

  const handleSavePlan = async () => {
    if (!plan || selectedBlocks.size === 0) return;

    const selectedBlocksArray = plan.blocks.filter((_, index) =>
      selectedBlocks.has(index),
    );

    try {
      await createMutation.mutateAsync({
        week: plan.week,
        weekNumber: plan.weekNumber,
        year: plan.year,
        blocks: selectedBlocksArray,
        totalHours: beregnTimer(selectedBlocksArray),
      });

      showToast.success("Arbeidsplan lagret!");
      onPlanCreated?.();
      setPlan(null);
      setSelectedBlocks(new Set());
    } catch {
      showToast.error("Kunne ikke lagre arbeidsplan. Prøv igjen.");
    }
  };

  if (!plan && !generateWeeklyPlan.isPending && !error) {
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
              La KI-assistenten analysere dine Canvas-oppgaver og lage en optimal studieukeplan.
              Du kan deretter velge hvilke studieblokker du vil legge til i din arbeidsplan.
            </p>
            <button
              onClick={generatePlan}
              disabled={assignments.length === 0}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Generer ukeplan med AI
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

  if (generateWeeklyPlan.isPending) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-12">
        <div className="text-center space-y-4">
          <LoadingSpinner className="w-12 h-12" />
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              KI-assistenten genererer ukeplan...
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Analyserer oppgaver, frister og kompleksitet
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
  }, {} as Record<string, Array<StudyBlock & { index: number }>>);

  const sortedDays = Object.keys(blocksByDay).sort(
    (a, b) => DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b),
  );

  const allSelected = selectedBlocks.size === plan.blocks.length;
  const someSelected =
    selectedBlocks.size > 0 && selectedBlocks.size < plan.blocks.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-linear-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                KI-generert ukeplan
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {plan.week} • {plan.totalHours.toFixed(1)} timer totalt
            </p>
          </div>
          <button
            onClick={generatePlan}
            className="px-4 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
          >
            Regenerer
          </button>
        </div>

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
              {allSelected && (
                <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
              )}
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
                Legg til i min plan ({selectedBlocks.size})
              </>
            )}
          </button>
        </div>
      </div>

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
                    {dayBlocks.length} {dayBlocks.length === 1 ? "oppgave" : "oppgaver"}
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
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${PRIORITY_COLORS[block.priority]}`}
                            >
                              {PRIORITY_LABELS[block.priority]}
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

      {plan.tips.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-300 mb-2">
                Studietips fra KI-assistenten
              </h4>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                {plan.tips.map((tip, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

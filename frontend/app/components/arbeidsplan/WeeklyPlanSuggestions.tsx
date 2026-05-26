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
import type { WeeklyPlanAssignment, WeeklyPlanSuggestionResponse } from "common/ki";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import {
  DAYS_ORDER,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  useCreateArbeidsplan,
  type StudyBlock,
} from "@/app/arbeidsplan/arbeidsplan-api";
import { useKIStore } from "@/app/store/kiStore";

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

export function WeeklyPlanSuggestions({ assignments, onPlanCreated }: WeeklyPlanSuggestionsProps) {
  const { t } = useLanguage();
  const [plan, setPlan] = useState<WeeklyPlanSuggestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const hydratedFromStoreRef = useRef(false);

  // Bakgrunnsgenerering via zustand-store (overlever navigering)
  const bgJob = useKIStore((s) => s.weeklyPlanJob);
  const startWeeklyPlan = useKIStore((s) => s.startWeeklyPlan);
  const clearWeeklyPlan = useKIStore((s) => s.clearWeeklyPlan);
  const createMutation = useCreateArbeidsplan();
  const isPending = bgJob?.status === "pending";

  // Hydrér fra bakgrunnsjobb (zustand store) — f.eks. etter navigering tilbake
  useEffect(() => {
    if (!bgJob || hydratedFromStoreRef.current) return;

    if (bgJob.status === "success" && bgJob.result) {
      hydratedFromStoreRef.current = true;
      setPlan(bgJob.result);
      setError(null);
      showToast.success(t("weeklyPlan.generatedToast", { count: bgJob.result.blocks.length }));
      clearWeeklyPlan();
    } else if (bgJob.status === "error") {
      hydratedFromStoreRef.current = true;
      setError(bgJob.error ?? t("arbeidsplan.planSaveError"));
      clearWeeklyPlan();
    }
  }, [bgJob, clearWeeklyPlan, t]);

  const generatePlan = () => {
    setError(null);
    setPlan(null);
    setSelectedBlocks(new Set());
    hydratedFromStoreRef.current = false;

    const hasAssignmentsWithDue = assignments.some((a) => !!a.dueAt);
    if (!hasAssignmentsWithDue) {
      setError(t("weeklyPlan.noAssignmentsWithDue"));
      return;
    }

    startWeeklyPlan(assignments);
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

    const selectedBlocksArray = plan.blocks.filter((_, index) => selectedBlocks.has(index));

    try {
      await createMutation.mutateAsync({
        week: plan.week,
        weekNumber: plan.weekNumber,
        year: plan.year,
        blocks: selectedBlocksArray,
        totalHours: beregnTimer(selectedBlocksArray),
      });

      showToast.success(t("arbeidsplan.planSaved"));
      onPlanCreated?.();
      setPlan(null);
      setSelectedBlocks(new Set());
    } catch {
      showToast.error(t("arbeidsplan.planSaveError"));
    }
  };

  if (!plan && !isPending && !error) {
    return (
      <div className="rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20 p-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Sparkles className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              {t("weeklyPlan.title")}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
              {t("weeklyPlan.description")}
            </p>
            <button
              type="button"
              onClick={generatePlan}
              disabled={assignments.length === 0}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              {t("weeklyPlan.generateButton")}
            </button>
            {assignments.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                {t("weeklyPlan.noAssignments")}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-12">
        <LoadingView text={t("weeklyPlan.generating")} fullPage={false} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-6 space-y-4">
        <FeilMelding melding={error} />
        <button
          type="button"
          onClick={generatePlan}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {t("weeklyPlan.retryButton")}
        </button>
      </div>
    );
  }

  if (!plan) return null;

  const blocksByDay = plan.blocks.reduce(
    (acc, block, index) => {
      if (!acc[block.day]) acc[block.day] = [];
      acc[block.day].push({ ...block, index });
      return acc;
    },
    {} as Record<string, Array<StudyBlock & { index: number }>>,
  );

  const sortedDays = Object.keys(blocksByDay).sort(
    (a, b) => DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b),
  );

  const allDaysExpanded = sortedDays.length > 0 && sortedDays.every((d) => expandedDays.has(d));
  const anyDayExpanded = expandedDays.size > 0;

  const allSelected = selectedBlocks.size === plan.blocks.length;
  const someSelected = selectedBlocks.size > 0 && selectedBlocks.size < plan.blocks.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-linear-to-br from-blue-50 to-slate-50 dark:from-blue-950/20 dark:to-slate-900/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {t("weeklyPlan.generatedTitle")}
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {plan.week} • {plan.totalHours.toFixed(1)} timer totalt
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setExpandedDays(new Set(sortedDays))}
              disabled={allDaysExpanded}
              className="px-3 py-2 text-sm rounded-lg bg-white/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("arbeidsplan.expandAll")}
            </button>
            <button
              type="button"
              onClick={() => setExpandedDays(new Set())}
              disabled={!anyDayExpanded}
              className="px-3 py-2 text-sm rounded-lg bg-white/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("arbeidsplan.collapseAll")}
            </button>
            <button
              type="button"
              onClick={generatePlan}
              className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
            >
              {t("weeklyPlan.regenerateButton")}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                allSelected
                  ? "bg-blue-600 border-blue-600"
                  : someSelected
                    ? "bg-blue-300 border-blue-600"
                    : "border-slate-300 dark:border-slate-600"
              }`}
            >
              {allSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
              {someSelected && !allSelected && <div className="w-2 h-2 bg-blue-600 rounded-sm" />}
            </button>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {selectedBlocks.size === 0
                ? t("weeklyPlan.selectPrompt")
                : t("weeklyPlan.selectedCount", { count: selectedBlocks.size })}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSavePlan}
            disabled={selectedBlocks.size === 0 || createMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("weeklyPlan.saving")}
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {t("weeklyPlan.addToPlan", { count: selectedBlocks.size })}
              </>
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {sortedDays.map((day) => {
          const dayBlocks = blocksByDay[day];
          const isExpanded = expandedDays.has(day);

          return (
            <div
              key={day}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(day)) next.delete(day);
                    else next.add(day);
                    return next;
                  })
                }
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-400" />
                  <span className="font-semibold text-slate-900 dark:text-white">{day}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {dayBlocks.length === 1
                      ? t("weeklyPlan.taskCount", { count: dayBlocks.length })
                      : t("weeklyPlan.tasksCount", { count: dayBlocks.length })}
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
                          type="button"
                          onClick={() => toggleBlockSelection(block.index)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            selectedBlocks.has(block.index)
                              ? "bg-blue-600 border-blue-600"
                              : "border-slate-300 dark:border-slate-600 hover:border-blue-600"
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
                {t("weeklyPlan.tipsTitle")}
              </h4>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                {plan.tips.map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
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

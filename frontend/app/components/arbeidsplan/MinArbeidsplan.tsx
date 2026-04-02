/*
 * MinArbeidsplan - Viser brukerens godkjente studieblokker for uken
 * Med progress tracking og fullført-funksjonalitet
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Calendar, 
  Check, 
  Clock, 
  Trash2, 
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Sparkles,
  CheckCircle2,
  Info
} from "lucide-react";
import {
  useCurrentArbeidsplan,
  useToggleBlockCompletion,
  useDeleteArbeidsplan,
  useProgressStats,
  type StudyBlock
} from "@/app/arbeidsplan/arbeidsplan-api";
import { PRIORITY_COLORS, DAYS_ORDER, PRIORITY_LABELS } from "@/app/arbeidsplan/arbeidsplan-api";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { formaterDatoMedTid } from "@/app/lib/dato";

/** Forklaring for hvorfor en oppgave har en gitt prioritet */
function getPriorityExplanation(priority: string, task: string, t: (key: "minArbeidsplan.priorityHighDeadline" | "minArbeidsplan.priorityHigh" | "minArbeidsplan.priorityMedium" | "minArbeidsplan.priorityLowRepetition" | "minArbeidsplan.priorityLow") => string): string {
  const lower = task.toLowerCase();
  const harFrist = /frist|deadline|innlevering|eksamen/.test(lower);
  const harRepetisjon = /repeter|gjennomgå|les igjen|oppsummer/.test(lower);

  switch (priority) {
    case "high":
      if (harFrist) return t("minArbeidsplan.priorityHighDeadline");
      return t("minArbeidsplan.priorityHigh");
    case "medium":
      return t("minArbeidsplan.priorityMedium");
    case "low":
      if (harRepetisjon) return t("minArbeidsplan.priorityLowRepetition");
      return t("minArbeidsplan.priorityLow");
    default:
      return "";
  }
}

export function MinArbeidsplan() {
  const { language, t } = useLanguage();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimerRef.current), []);
  const { data: plan, isLoading, isError, refetch } = useCurrentArbeidsplan();
  const { data: stats } = useProgressStats();
  const toggleMutation = useToggleBlockCompletion();
  const deleteMutation = useDeleteArbeidsplan();

  const handleToggleComplete = (blockIndex: number, currentStatus: boolean) => {
    if (!plan?._id) return;
    
    toggleMutation.mutate({
      planId: plan._id,
      blockIndex,
      completed: !currentStatus,
    });
  };

  const handleDeletePlan = () => {
    if (!plan?._id) return;
    if (!bekreftSlett) {
      setBekreftSlett(true);
      return;
    }
    setBekreftSlett(false);
    setPendingDelete(true);

    showToast.undoable(
      t("arbeidsplan.planDeleted"),
      () => {
        clearTimeout(undoTimerRef.current);
        setPendingDelete(false);
        showToast.info(t("arbeidsplan.deleteUndone"));
      },
      5000,
    );

    undoTimerRef.current = setTimeout(() => {
      deleteMutation.mutate(plan._id);
      setPendingDelete(false);
    }, 5000);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-8">
        <LoadingView text={t("arbeidsplan.loadingPlan")} fullPage={false} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-6 space-y-4">
        <FeilMelding melding={t("arbeidsplan.loadError")} />
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {t("minArbeidsplan.retryButton")}
        </button>
      </div>
    );
  }

  if (!plan || plan.blocks.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 p-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30">
            <Sparkles className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              {t("minArbeidsplan.emptyTitle")}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {t("minArbeidsplan.emptyDescription")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Grupper blokker etter dag
  const blocksByDay = plan.blocks.reduce((acc, block, index) => {
    if (!acc[block.day]) {
      acc[block.day] = [];
    }
    acc[block.day].push({ ...block, index });
    return acc;
  }, {} as Record<string, (StudyBlock & { index: number })[]>);

  // Sorter dager
  const sortedDays = Object.keys(blocksByDay).sort((a, b) => {
    return DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b);
  });
  const allExpanded = sortedDays.every((day) => expandedDays.has(day));
  const anyExpanded = expandedDays.size > 0;

  const handleExpandAll = () => {
    setExpandedDays(new Set(sortedDays));
  };

  const handleCollapseAll = () => {
    setExpandedDays(new Set());
  };

  const handleToggleDay = (day: string) => {
    setExpandedDays((previous) => {
      const next = new Set(previous);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  return (
    <div className={`space-y-4 transition-opacity ${pendingDelete ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Header med progress */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-linear-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">
              {plan.week}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t("minArbeidsplan.personalPlanLabel")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleExpandAll}
              disabled={allExpanded}
              className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("arbeidsplan.expandAll")}
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              disabled={!anyExpanded}
              className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("arbeidsplan.collapseAll")}
            </button>
            <button
              type="button"
              onClick={handleDeletePlan}
              onBlur={() => setBekreftSlett(false)}
              disabled={deleteMutation.isPending || pendingDelete}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                bekreftSlett
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
              }`}
              title={t("minArbeidsplan.deleteTitle")}
            >
              {bekreftSlett ? t("minArbeidsplan.deleteConfirm") : <Trash2 className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {stats && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t("minArbeidsplan.progressLabel")}
                </span>
              </div>
              <span className="text-slate-600 dark:text-slate-400">
                {t("minArbeidsplan.tasksCount", { completed: stats.completedBlocks, total: stats.totalBlocks })}
              </span>
            </div>
            
            <div className="relative h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-linear-to-r from-purple-500 to-blue-500 transition-all duration-500 rounded-full"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>{t("minArbeidsplan.percentComplete", { percent: stats.percentage })}</span>
              <span>{t("minArbeidsplan.hoursCount", { completed: stats.completedHours, total: stats.totalHours })}</span>
            </div>
          </div>
        )}
      </div>

      {/* Studieblokker gruppert etter dag */}
      <div className="space-y-3">
        {sortedDays.map((day) => {
          const dayBlocks = blocksByDay[day];
          const completed = dayBlocks.filter(b => b.completed).length;
          const total = dayBlocks.length;
          const isExpanded = expandedDays.has(day);

          return (
            <div
              key={day}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden"
            >
              {/* Day header */}
              <button
                type="button"
                onClick={() => handleToggleDay(day)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  <div className="text-left">
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      {day}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t("minArbeidsplan.completedCount", { completed, total })}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  {completed === total && total > 0 && (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </button>

              {/* Day blocks */}
              {isExpanded && (
                <div className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {dayBlocks.map((block) => (
                    <div
                      key={block.index}
                      className={`p-4 transition-all ${
                        block.completed 
                          ? "opacity-60 bg-slate-50 dark:bg-slate-900/30" 
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={() => handleToggleComplete(block.index, block.completed)}
                          disabled={toggleMutation.isPending}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all disabled:opacity-50 ${
                            block.completed
                              ? "bg-green-500 border-green-500"
                              : "border-slate-300 dark:border-slate-600 hover:border-green-500 dark:hover:border-green-500"
                          }`}
                        >
                          {block.completed && (
                            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                          )}
                        </button>

                        {/* Block content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0">
                              <h4 className={`font-medium text-sm mb-1 ${
                                block.completed 
                                  ? "line-through text-slate-500 dark:text-slate-500"
                                  : "text-slate-900 dark:text-white"
                              }`}>
                                {block.task}
                              </h4>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {block.courseName}
                              </p>
                            </div>
                            
                            <div className="relative group/prio flex items-center gap-1">
                              <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${PRIORITY_COLORS[block.priority]}`}>
                                {PRIORITY_LABELS[block.priority]}
                              </span>
                              <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                              <div className="absolute right-0 top-full mt-1 z-20 w-52 p-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs shadow-lg opacity-0 pointer-events-none group-hover/prio:opacity-100 transition-opacity">
                                {getPriorityExplanation(block.priority, block.task, t)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{block.timeSlot}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span>⏱</span>
                              <span>{block.duration}</span>
                            </div>
                            {block.completedAt && (
                              <div className="text-green-600 dark:text-green-400">
                                ✓ {t("arbeidsplan.completedAt", {
                                  date: formaterDatoMedTid(block.completedAt, language),
                                })}
                              </div>
                            )}
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
    </div>
  );
} 

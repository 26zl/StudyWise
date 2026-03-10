/*
 * MinArbeidsplan - Viser brukerens godkjente studieblokker for uken
 * Med progress tracking og fullført-funksjonalitet
 */
"use client";

import { useState } from "react";
import { 
  Calendar, 
  Check, 
  Clock, 
  Trash2, 
  AlertCircle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import { 
  useCurrentArbeidsplan, 
  useToggleBlockCompletion, 
  useDeleteArbeidsplan,
  useProgressStats,
  type StudyBlock 
} from "../arbeidsplan/arbeidsplan-api";
import { LoadingSpinner } from "./LoadingSpinner";

const PRIORITY_COLORS = {
  high: "bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
  medium: "bg-yellow-100 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300",
  low: "bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300",
};

const DAYS_ORDER = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

export function MinArbeidsplan() {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const { data: plan, isLoading, isError } = useCurrentArbeidsplan();
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
    
    if (confirm("Er du sikker på at du vil slette hele arbeidsplanen for denne uken?")) {
      deleteMutation.mutate(plan._id);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-8">
        <div className="flex items-center justify-center gap-3">
          <LoadingSpinner />
          <span className="text-slate-500 dark:text-slate-400">Laster arbeidsplan...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">
            Kunne ikke laste arbeidsplan. Prøv igjen senere.
          </p>
        </div>
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
              Ingen arbeidsplan enda
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Generer en ukeplan med KI og godkjenn studieblokker for å se dem her. 
              Du vil kunne følge fremdriften din gjennom uken.
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

  return (
    <div className="space-y-4">
      {/* Header med progress */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
              {plan.week}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Din personlige arbeidsplan
            </p>
          </div>
          <button
            onClick={handleDeletePlan}
            disabled={deleteMutation.isPending}
            className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
            title="Slett arbeidsplan"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        {stats && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Fremdrift
                </span>
              </div>
              <span className="text-slate-600 dark:text-slate-400">
                {stats.completedBlocks} / {stats.totalBlocks} oppgaver
              </span>
            </div>
            
            <div className="relative h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500 rounded-full"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>{stats.percentage}% fullført</span>
              <span>{stats.completedHours} / {stats.totalHours} timer</span>
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
          const isExpanded = expandedDay === day;

          return (
            <div
              key={day}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden"
            >
              {/* Day header */}
              <button
                onClick={() => setExpandedDay(isExpanded ? null : day)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  <div className="text-left">
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      {day}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {completed} / {total} fullført
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
                            
                            <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${PRIORITY_COLORS[block.priority]}`}>
                              {block.priority === "high" ? "Høy" : block.priority === "medium" ? "Medium" : "Lav"}
                            </span>
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
                                ✓ Fullført {new Date(block.completedAt).toLocaleString("nb-NO", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
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
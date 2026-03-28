/*
 * AddToWorkplanModal - Modal for å legge til AI-genererte deloppgaver i arbeidsplan
 * Lar brukeren velge uke og dager, og fordele oppgaver automatisk
 */
"use client";

import { useState, useMemo, useRef, useId, useCallback } from "react";
import { X, Calendar, Clock, CheckCircle2, Sparkles, AlertTriangle } from "lucide-react";
import type { SubTask } from "common/ki";
import { getIsoWeekInfo, parseTimerStreng } from "common/dateUtils";
import { UKEDAGER } from "common/arbeidsplan";
import { useCreateArbeidsplan, useCurrentArbeidsplan, type StudyBlock } from "@/app/arbeidsplan/arbeidsplan-api";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";

interface AddToWorkplanModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtasks: SubTask[];
  assignmentTitle: string;
}

const TIME_SLOTS = [
  "08:00-10:00",
  "10:00-12:00",
  "12:00-14:00",
  "14:00-16:00",
  "16:00-18:00",
  "18:00-20:00",
  "20:00-22:00",
];

export function AddToWorkplanModal({
  isOpen,
  onClose,
  subtasks,
  assignmentTitle,
}: AddToWorkplanModalProps) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [selectedWeek, setSelectedWeek] = useState<"current" | "next">("current");
  const [selectedDays, setSelectedDays] = useState<StudyBlock["day"][]>(["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"]);
  const [startTime, setStartTime] = useState("08:00-10:00");
  
  const { mutate: createPlan, isPending } = useCreateArbeidsplan();
  const { data: existingPlan } = useCurrentArbeidsplan();

  const handleClose = useCallback(() => {
    if (!isPending) {
      onClose();
    }
  }, [isPending, onClose]);

  useDialogAccessibility({
    open: isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: handleClose,
  });

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        handleClose();
      }
    },
    [handleClose],
  );

  const toggleDay = (day: StudyBlock["day"]) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const selectWeekdays = () => {
    setSelectedDays(["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"]);
  };

  const selectWeekend = () => {
    setSelectedDays(["Lørdag", "Søndag"]);
  };

  const selectAll = () => {
    setSelectedDays([...UKEDAGER]);
  };

  const clearAll = () => {
    setSelectedDays([]);
  };

  // Konverter SubTask til StudyBlock og fordel over valgte dager
  const handleAdd = () => {
    if (selectedDays.length === 0) {
      showToast.error(t("arbeidsplan.selectAtLeastOneDay"));
      return;
    }

    // Fordel oppgaver jevnt over valgte dager
    const blocks: StudyBlock[] = subtasks.map((task, index) => {
      const dayIndex = index % selectedDays.length;
      const day = selectedDays[dayIndex];

      return {
        day,
        timeSlot: startTime,
        task: task.title,
        duration: task.estimatedTime,
        priority: task.priority,
        courseName: assignmentTitle,
        assignmentId: undefined,
        completed: false,
      };
    });

    const totalHours = subtasks.reduce((sum, task) => sum + parseTimerStreng(task.estimatedTime), 0);

    // Opprett arbeidsplan
    createPlan(
      {
        week: weekText,
        weekNumber,
        year: weekYear,
        blocks,
        totalHours,
      },
      {
        onSuccess: () => {
          showToast.success(
            `${subtasks.length} oppgaver lagt til i ${weekText}!`,
            "Gå til Oversikt for å se din arbeidsplan"
          );
          onClose();
        },
        onError: () => {
          showToast.error(
            t("arbeidsplan.addToWorkplanError"),
            t("arbeidsplan.addToWorkplanErrorDescription")
          );
        },
      }
    );
  };

  // Beregn fordeling (speiler round-robin-logikken i handleAdd)
  const tasksPerDay = subtasks.reduce((acc, _, i) => {
    const day = selectedDays[i % selectedDays.length];
    acc[day] = (acc[day] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<StudyBlock["day"], number>>);

  // Sjekk konflikter mot eksisterende plan
  const conflicts = useMemo(() => {
    if (!existingPlan?.blocks || selectedDays.length === 0) return [];
    const found: { day: string; timeSlot: string; existingTask: string }[] = [];
    const seen = new Set<string>();
    for (const sub of subtasks) {
      const dayIndex = subtasks.indexOf(sub) % selectedDays.length;
      const day = selectedDays[dayIndex];
      for (const existing of existingPlan.blocks) {
        if (existing.day === day && existing.timeSlot === startTime) {
          const key = `${day}-${existing.timeSlot}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({ day, timeSlot: existing.timeSlot, existingTask: existing.task });
          }
        }
      }
    }
    return found;
  }, [existingPlan?.blocks, selectedDays, startTime, subtasks]);

  if (!isOpen) return null;

  // Beregn uke-tekst med ISO 8601-korrekt ukenummer
  const now = new Date();
  const selectedDate = new Date(now);
  if (selectedWeek === "next") {
    selectedDate.setDate(selectedDate.getDate() + 7);
  }
  const { weekNumber, weekYear } = getIsoWeekInfo(selectedDate);
  const { weekNumber: currentWeekNumber, weekYear: currentWeekYear } = getIsoWeekInfo(now);
  const nextWeekDate = new Date(now);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const { weekNumber: nextWeekNumber, weekYear: nextWeekYear } = getIsoWeekInfo(nextWeekDate);
  const weekText = `Uke ${weekNumber}, ${weekYear}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none dark:bg-slate-900"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 id={titleId} className="text-xl font-bold text-slate-900 dark:text-white">
                Legg til i arbeidsplan
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {subtasks.length} deloppgaver fra {assignmentTitle}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Lukk dialogen"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Velg uke */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Velg uke
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedWeek("current")}
                aria-pressed={selectedWeek === "current"}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedWeek === "current"
                    ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    Denne uken
                  </span>
                  {selectedWeek === "current" && (
                    <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  )}
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Uke {currentWeekNumber}, {currentWeekYear}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedWeek("next")}
                aria-pressed={selectedWeek === "next"}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedWeek === "next"
                    ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    Neste uke
                  </span>
                  {selectedWeek === "next" && (
                    <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  )}
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Uke {nextWeekNumber}, {nextWeekYear}
                </span>
              </button>
            </div>
          </div>

          {/* Velg starttid */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Standard starttid
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>

          {/* Velg dager */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-slate-900 dark:text-white">
                Velg dager å fordele over
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectWeekdays}
                  className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Ukedager
                </button>
                <button
                  type="button"
                  onClick={selectWeekend}
                  className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Helg
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Alle
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Ingen
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {UKEDAGER.map((day) => {
                const count = tasksPerDay[day] || 0;
                const isSelected = selectedDays.includes(day);
                const hasConflict = conflicts.some((c) => c.day === day);

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={isSelected}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      isSelected
                        ? hasConflict
                          ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                          : "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {day.slice(0, 3)}
                      </span>
                      <div className="flex items-center gap-1">
                        {isSelected && hasConflict && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        )}
                        {isSelected && count > 0 && (
                          <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                            {count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Konfliktvarsel */}
          {conflicts.length > 0 && (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                    {conflicts.length === 1 ? "1 tidskonflikt oppdaget" : `${conflicts.length} tidskonflikter oppdaget`}
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                    Noen tidsluker overlapper med eksisterende oppgaver. Vurder å velge et annet tidspunkt.
                  </p>
                  <div className="space-y-1">
                    {conflicts.map((c, i) => (
                      <div key={i} className="text-xs text-amber-800 dark:text-amber-200">
                        <span className="font-medium">{c.day} {c.timeSlot}:</span> «{c.existingTask}»
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Preview */}
          {selectedDays.length > 0 && (
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    Automatisk fordeling
                  </h4>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                    Dine {subtasks.length} deloppgaver vil bli fordelt jevnt over {selectedDays.length} valgte dager.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedDays.map((day) => {
                      const count = tasksPerDay[day] || 0;
                      if (count === 0) return null;
                      return (
                        <div
                          key={day}
                          className="px-2 py-1 rounded bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          {day}: {count} oppg.
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || selectedDays.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
          >
            {isPending ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                Legger til...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Legg til i {weekText}
              </>
            )}
          </button> 
        </div>
      </div>
    </div>
  );
}

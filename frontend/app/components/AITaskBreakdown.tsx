/*
 * AITaskBreakdown - KOMPLETT VERSJON
 * - Progress tracking med stats
 * - Arbeidsplan-integrasjon
 * - Godkjenn/avvis funksjonalitet
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Sparkles, 
  Edit2, 
  Check, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ThumbsUp, 
  ThumbsDown,
  TrendingUp,
  Clock,
  CheckCircle2,
  Calendar as CalendarIcon
} from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { showToast } from "./Toaster";
import { AddToWorkplanModal } from "./AddToWorkplanModal";
import type { SubTask } from "common/ki";

// UI-state utvider SubTask med godkjenningsstatus
interface SubTaskUI extends SubTask {
  approved?: boolean;
}

interface AITaskBreakdownProps {
  assignmentTitle: string;
  assignmentDescription?: string;
  dueDate?: Date;
  onSave?: (subtasks: SubTask[]) => void;
}

// Progress stats
interface ProgressStats {
  total: number;
  approved: number;
  completed: number;
  remaining: number;
  percentageApproved: number;
  percentageCompleted: number;
  totalEstimatedHours: number;
  completedHours: number;
}

export function AITaskBreakdown({
  assignmentTitle: _assignmentTitle,
  assignmentDescription: _assignmentDescription,
  dueDate: _dueDate, 
}: AITaskBreakdownProps) {
  const [subtasks, setSubtasks] = useState<SubTaskUI[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubTask>>({});
  const [showEditor, setShowEditor] = useState(false);
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);
  const [showWorkplanModal, setShowWorkplanModal] = useState(false);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Beregn progress stats
  const calculateProgress = (): ProgressStats => {
    const total = subtasks.length;
    const approved = subtasks.filter(t => t.approved).length;
    const completed = subtasks.filter(t => t.completed).length;
    const remaining = approved - completed;
    const percentageApproved = total > 0 ? Math.round((approved / total) * 100) : 0;
    const percentageCompleted = approved > 0 ? Math.round((completed / approved) * 100) : 0;
    
    // Parse estimated time (f.eks. "2t" -> 2, "1.5t" -> 1.5)
    const parseTime = (time: string): number => {
      const match = time.match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    };
    
    const totalEstimatedHours = subtasks.reduce((sum, t) => sum + parseTime(t.estimatedTime), 0);
    const completedHours = subtasks
      .filter(t => t.completed)
      .reduce((sum, t) => sum + parseTime(t.estimatedTime), 0);
    
    return {
      total,
      approved,
      completed,
      remaining,
      percentageApproved,
      percentageCompleted,
      totalEstimatedHours,
      completedHours,
    };
  };

  const stats = calculateProgress();

  // Generer deloppgaver med AI
  const generateSubtasks = () => {
    setIsGenerating(true);

    timeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      const mockSubtasks: SubTaskUI[] = [
        {
          id: `task-${Date.now()}-1`,
          title: "Research og kildeinnsamling",
          description: "Finn 5-7 relevante fagartikler og noter nøkkelpunkter fra pensum",
          estimatedTime: "2t",
          priority: "high",
          completed: false,
          approved: false,
        },
        {
          id: `task-${Date.now()}-2`,
          title: "Lage disposisjon",
          description: "Strukturer oppgaven i logiske seksjoner basert på pensum og krav",
          estimatedTime: "1t",
          priority: "high",
          completed: false,
          approved: false,
        },
        {
          id: `task-${Date.now()}-3`,
          title: "Skriv introduksjon",
          description: "Presenter problemstilling og gi oversikt over oppgavens struktur",
          estimatedTime: "1.5t",
          priority: "medium",
          completed: false,
          approved: false,
        },
        {
          id: `task-${Date.now()}-4`,
          title: "Hovedtekst - Implementasjon",
          description: "Skriv hovedinnhold med teori, kode og analyse",
          estimatedTime: "4t",
          priority: "high",
          completed: false,
          approved: false,
        },
        {
          id: `task-${Date.now()}-5`,
          title: "Konklusjon og sammendrag",
          description: "Oppsummer funn og reflekter over læring",
          estimatedTime: "1t",
          priority: "medium",
          completed: false,
          approved: false,
        },
      ];

      setSubtasks(mockSubtasks);
      setShowEditor(true);
      setShowApprovalPrompt(true);
      setIsGenerating(false);
    }, 2000);
  };

  const approveTask = (id: string) => {
    setSubtasks(subtasks.map(t => t.id === id ? { ...t, approved: true } : t));
  };

  const rejectTask = (id: string) => {
    setSubtasks(subtasks.filter(t => t.id !== id));
  };

  const approveAll = () => {
    setSubtasks(subtasks.map(t => ({ ...t, approved: true })));
    setShowApprovalPrompt(false);
    showToast.success("Alle deloppgaver godkjent!");
  };

  const rejectAll = () => {
    setSubtasks([]);
    setShowEditor(false);
    setShowApprovalPrompt(false);
    showToast.info("Alle deloppgaver avvist");
  };

  const toggleComplete = (id: string) => {
    setSubtasks(subtasks.map(t => 
      t.id === id ? { ...t, completed: !t.completed } : t
    ));
  };

  const startEdit = (task: SubTaskUI) => {
    setEditingId(task.id);
    setEditForm({ 
      title: task.title, 
      description: task.description, 
      estimatedTime: task.estimatedTime, 
      priority: task.priority 
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    setSubtasks(subtasks.map(t =>
      t.id === editingId
        ? { ...t, ...editForm }
        : t
    ));
    setEditingId(null);
    setEditForm({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const addNewTask = () => {
    const newTask: SubTaskUI = {
      id: `task-${Date.now()}`,
      title: "Ny deloppgave",
      description: "",
      estimatedTime: "1t",
      priority: "medium",
      completed: false,
      approved: true,
    };
    setSubtasks([...subtasks, newTask]);
    startEdit(newTask);
  };

  const deleteTask = (id: string) => {
    setSubtasks(subtasks.filter(t => t.id !== id));
  };

  const priorityColors = {
    low: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700",
    medium: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
    high: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700",
  };

  const priorityLabels = {
    low: "Lav",
    medium: "Middels",
    high: "Høy",
  };

  return (
    <div className="space-y-4">
      {/* Generate Button */}
      {!showEditor && (
        <button
          onClick={generateSubtasks}
          disabled={isGenerating}
          className="w-full px-4 py-3 rounded-lg border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <div className="flex items-center justify-center gap-3">
            {isGenerating ? (
              <>
                <LoadingSpinner className="w-5 h-5" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Genererer deloppgaver...
                </span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 group-hover:text-blue-800 dark:group-hover:text-blue-200">
                  Få KI til å foreslå deloppgaver
                </span>
              </>
            )}
          </div>
        </button>
      )}

      {/* Editor */}
      {showEditor && (
        <div className="space-y-4">
          {/* PROGRESS CARD */}
          {stats.approved > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-linear-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Fremdrift
                    </h3>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {stats.completed} av {stats.approved} deloppgaver fullført
                  </p>
                </div>
                {stats.completed === stats.approved && (
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                )}
              </div>

              {/* Progress Bar */}
              <div className="space-y-2 mb-4">
                <div className="relative h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-linear-to-r from-purple-500 to-blue-500 transition-all duration-500 rounded-full"
                    style={{ width: `${stats.percentageCompleted}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <span>{stats.percentageCompleted}% fullført</span>
                  <span>{stats.completedHours.toFixed(1)} / {stats.totalEstimatedHours.toFixed(1)} timer</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-slate-900/30">
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {stats.approved}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Godkjent
                  </div>
                </div>
                <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-slate-900/30">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {stats.completed}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Fullført
                  </div>
                </div>
                <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-slate-900/30">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {stats.remaining}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Gjenstår
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Godkjenne/Avvise Banner */}
          {showApprovalPrompt && (
            <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-1">
                    AI har generert {subtasks.length} deloppgaver for deg
                  </h4>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-3">
                    Gå gjennom forslagene og godkjenn, avvis, eller rediger dem etter din arbeidsstil.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={approveAll}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Godkjenn alle
                    </button>
                    <button
                      onClick={rejectAll}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Avvis alle
                    </button>
                    <button
                      onClick={() => setShowApprovalPrompt(false)}
                      className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"
                    >
                      Gå gjennom manuelt
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                KI-foreslåtte deloppgaver
              </h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                ({stats.approved}/{stats.total} godkjent)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={generateSubtasks}
                disabled={isGenerating}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Regenerer deloppgaver"
              >
                <RefreshCw className={`w-4 h-4 text-slate-600 dark:text-slate-400 ${isGenerating ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={addNewTask}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Ny oppgave
              </button>

              {/* ARBEIDSPLAN KNAPP - NY! */}
              {stats.approved > 0 && (
                <button
                  onClick={() => setShowWorkplanModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <CalendarIcon className="w-4 h-4" />
                  Legg til i arbeidsplan ({stats.approved})
                </button>
              )}
            </div>
          </div>

          {/* Subtasks List */}
          <div className="space-y-3">
            {subtasks.map((task) => (
              <div
                key={task.id}
                className={`rounded-lg border ${
                  task.completed
                    ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
                    : task.approved
                    ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
                    : "border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20"
                } p-4 transition-all`}
              >
                {editingId === task.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editForm.title || ""}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      placeholder="Tittel"
                    />
                    <textarea
                      value={editForm.description || ""}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white resize-none"
                      rows={3}
                      placeholder="Beskrivelse"
                    />
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={editForm.estimatedTime || ""}
                        onChange={(e) => setEditForm({ ...editForm, estimatedTime: e.target.value })}
                        className="w-24 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                        placeholder="2t"
                      />
                      <select
                        value={editForm.priority || "medium"}
                        onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as "low" | "medium" | "high" })}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      >
                        <option value="low">Lav prioritet</option>
                        <option value="medium">Middels prioritet</option>
                        <option value="high">Høy prioritet</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        Lagre
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"
                      >
                        Avbryt
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    {task.approved && (
                      <button
                        onClick={() => toggleComplete(task.id)}
                        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          task.completed
                            ? "bg-green-500 border-green-500"
                            : "border-slate-300 dark:border-slate-600 hover:border-green-500"
                        }`}
                      >
                        {task.completed && (
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                        )}
                      </button>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h4 className={`font-medium text-slate-900 dark:text-white ${
                          task.completed ? "line-through opacity-60" : ""
                        }`}>
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-1 rounded text-xs font-medium border ${priorityColors[task.priority]}`}>
                            {priorityLabels[task.priority]}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <Clock className="w-3.5 h-3.5" />
                            {task.estimatedTime}
                          </span>
                        </div>
                      </div>

                      {task.description && (
                        <p className={`text-sm text-slate-600 dark:text-slate-400 mb-3 ${
                          task.completed ? "opacity-60" : ""
                        }`}>
                          {task.description}
                        </p>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {!task.approved ? (
                          <>
                            <button
                              onClick={() => approveTask(task.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                              Godkjenn
                            </button>
                            <button
                              onClick={() => rejectTask(task.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                              Avvis
                            </button>
                            <button
                              onClick={() => startEdit(task)}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              title="Rediger"
                            >
                              <Edit2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(task)}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              title="Rediger"
                            >
                              <Edit2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                            </button>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                              title="Slett"
                            >
                              <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ARBEIDSPLAN MODAL - NY! */}
      <AddToWorkplanModal
        isOpen={showWorkplanModal}
        onClose={() => setShowWorkplanModal(false)}
        subtasks={subtasks.filter(t => t.approved).map(({ approved: _approved, ...rest }) => rest)}
        assignmentTitle={_assignmentTitle}
      />
    </div>
  );
} 

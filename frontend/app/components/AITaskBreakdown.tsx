/*
 * AITaskBreakdown - KI-foreslåtte deloppgaver med godkjenne/avvise kontroll
 * Genererer smart nedbrytning av Canvas-oppgaver med AI
 */
"use client";

import { useState } from "react";
import { Sparkles, Edit2, Check, X, Plus, Trash2, RefreshCw, Loader2, ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { useKIChat } from "../ki/ki-api";
import type { SubTask } from "common/ki";
// Kun typen importeres her — komponenten håndterer ikke API-kall direkte.
// Når ekte AI-integrasjon legges til, skal henting og validering (med TaskBreakdownResponseSchema)
// ligge i en dedikert hook (se mønsteret i frontend/app/ki/ki-api.ts).

// UI-state utvider SubTask med godkjenningsstatus — strippes før onSave
interface SubTaskUI extends SubTask {
  approved?: boolean; // Godkjent av bruker?
}
// Props for AITaskBreakdown-komponenten
interface AITaskBreakdownProps {
  assignmentTitle: string;
  assignmentDescription?: string;
  dueDate?: Date;
  onSave?: (subtasks: SubTask[]) => void;
}
// Hovedkomponent for AI-generert deloppgaveoversikt med godkjenningskontroll
export function AITaskBreakdown({
  assignmentTitle: _assignmentTitle,
  assignmentDescription: _assignmentDescription,
  dueDate: _dueDate,
  onSave,
}: AITaskBreakdownProps) {
  const [subtasks, setSubtasks] = useState<SubTaskUI[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubTask>>({});
  const [showEditor, setShowEditor] = useState(false);
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);

  const { sendMelding: _sendMelding } = useKIChat();

  // Generer deloppgaver med AI
  const generateSubtasks = async () => {
    setIsGenerating(true);

    // MOCK DATA - Erstatt med ekte Claude AI-kall
    setTimeout(() => {
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
      ];

      setSubtasks(mockSubtasks);
      setShowEditor(true);
      setShowApprovalPrompt(true); // Vis godkjenne/avvise prompt
      setIsGenerating(false);
    }, 2000);
  };

  // Godkjenn alle forslag
  const approveAll = () => {
    setSubtasks((prev) => prev.map((task) => ({ ...task, approved: true })));
    setShowApprovalPrompt(false);
  };

  // Avvis alle forslag og start på nytt
  const rejectAll = () => {
    setSubtasks([]);
    setShowEditor(false);
    setShowApprovalPrompt(false);
  };

  // Godkjenn enkelt oppgave
  const approveTask = (id: string) => {
    setSubtasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, approved: true } : task))
    );
  };

  // Avvis enkelt oppgave
  const rejectTask = (id: string) => {
    setSubtasks((prev) => prev.filter((task) => task.id !== id));
  };

  // Start redigering av en deloppgave
  const startEditing = (task: SubTask) => {
    setEditingId(task.id);
    setEditForm(task);
  };

  // Lagre redigering
  const saveEdit = () => {
    if (!editingId) return;

    setSubtasks((prev) =>
      prev.map((task) =>
        task.id === editingId ? { ...task, ...editForm, approved: true } : task
      )
    );
    setEditingId(null);
    setEditForm({});
  };

  // Avbryt redigering
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // Slett deloppgave
  const deleteTask = (id: string) => {
    setSubtasks((prev) => prev.filter((task) => task.id !== id));
  };

  // Legg til ny deloppgave
  const addNewTask = () => {
    const newTask: SubTaskUI = {
      id: `task-${Date.now()}`,
      title: "Ny deloppgave",
      description: "Beskriv hva som må gjøres",
      estimatedTime: "1t",
      priority: "medium",
      completed: false,
      approved: false,
    };
    setSubtasks((prev) => [...prev, newTask]);
    startEditing(newTask);
  };

  // Toggle completed
  const toggleCompleted = (id: string) => {
    setSubtasks((prev) =>
      prev.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  };

  // Lagre til parent
  const handleSave = () => {
    const allApproved = subtasks.every((task) => task.approved);
    if (!allApproved) {
      toast.error("Du må godkjenne eller redigere alle forslagene før lagring!");
      return;
    }

    if (onSave) {
      // Strip UI-only felt (approved) før grensen mot parent/API
      onSave(subtasks.map(({ approved: _approved, ...task }) => task));
    }
    setShowEditor(false);
  };

  const priorityColors = {
    low: "text-slate-600 bg-slate-100 dark:bg-slate-800",
    medium: "text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30",
    high: "text-red-700 bg-red-100 dark:bg-red-900/30",
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
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Genererer deloppgaver...
                </span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-blue-600 group-hover:text-blue-700" />
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
          {/* NY: Godkjenne/Avvise Banner */}
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
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                KI-foreslåtte deloppgaver
              </h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                ({subtasks.filter(t => t.approved).length}/{subtasks.length} godkjent)
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
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Legg til ny deloppgave"
              >
                <Plus className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
          </div>

          {/* Subtasks List */}
          <div className="space-y-3">
            {subtasks.map((task, index) => (
              <div
                key={task.id}
                className={`p-4 rounded-lg border transition-all ${
                  task.approved
                    ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                    : task.completed
                    ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                    : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                }`}
              >
                {editingId === task.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editForm.title || ""}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium"
                      placeholder="Tittel på deloppgave"
                    />

                    <textarea
                      value={editForm.description || ""}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm resize-none"
                      rows={2}
                      placeholder="Beskrivelse av hva som må gjøres"
                    />

                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={editForm.estimatedTime || ""}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, estimatedTime: e.target.value }))
                        }
                        className="w-24 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        placeholder="2t"
                      />

                      <select
                        value={editForm.priority || "medium"}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            priority: e.target.value as "low" | "medium" | "high",
                          }))
                        }
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                      >
                        <option value="low">Lav prioritet</option>
                        <option value="medium">Middels prioritet</option>
                        <option value="high">Høy prioritet</option>
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Lagre og godkjenn
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleCompleted(task.id)}
                        className={`shrink-0 w-5 h-5 rounded border-2 mt-0.5 transition-colors ${
                          task.completed || task.approved
                            ? "border-green-500 bg-green-500"
                            : "border-slate-300 dark:border-slate-600 hover:border-green-500"
                        }`}
                      >
                        {(task.completed || task.approved) && <Check className="w-3 h-3 text-white" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4
                            className={`text-sm font-semibold ${
                              task.completed
                                ? "line-through text-slate-500"
                                : task.approved
                                ? "text-green-700 dark:text-green-400"
                                : "text-slate-900 dark:text-white"
                            }`}
                          >
                            {index + 1}. {task.title}
                            {task.approved && (
                              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                Godkjent
                              </span>
                            )}
                          </h4>

                          <div className="flex items-center gap-1 shrink-0">
                            {!task.approved && !task.completed && (
                              <>
                                <button
                                  onClick={() => approveTask(task.id)}
                                  className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                                  title="Godkjenn"
                                >
                                  <ThumbsUp className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                </button>
                                <button
                                  onClick={() => rejectTask(task.id)}
                                  className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                  title="Avvis"
                                >
                                  <ThumbsDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => startEditing(task)}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                              title="Rediger"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                            </button>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                              title="Slett"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                            </button>
                          </div>
                        </div>

                        <p
                          className={`text-sm mb-2 ${
                            task.completed
                              ? "line-through text-slate-400"
                              : "text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {task.description}
                        </p>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            ⏱️ {task.estimatedTime}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              priorityColors[task.priority]
                            }`}
                          >
                            {priorityLabels[task.priority]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Info Banner */}
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              💡 <strong>Tips:</strong> Godkjenn forslagene du liker, avvis de du ikke trenger, eller rediger dem slik at de passer din måte å jobbe på.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Lagre deloppgaver
            </button>
            <button
              onClick={() => {
                setShowEditor(false);
                setSubtasks([]);
                setShowApprovalPrompt(false);
              }}
              className="px-4 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* Progress Summary */}
      {!showEditor && subtasks.length > 0 && (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Fremgang
            </h4>
            <button
              onClick={() => setShowEditor(true)}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Vis detaljer →
            </button>
          </div>

          <div className="space-y-2">
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-blue-500 to-purple-600 transition-all duration-500"
                style={{
                  width: `${(subtasks.filter((t) => t.completed).length / subtasks.length) * 100}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>
                {subtasks.filter((t) => t.completed).length} av {subtasks.length} fullført
              </span>
              <span>
                {Math.round((subtasks.filter((t) => t.completed).length / subtasks.length) * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
/*
 * WeeklyPlanSuggestions - KOMPLETT MED AI OG GODKJENN-FUNKSJONALITET
 * - EKTE Claude AI generering
 * - Checkbox selection av studieblokker
 * - Lagring til arbeidsplan
 * - Success feedback
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
  CheckCircle,
  Loader2
} from "lucide-react";
import { LoadingSpinner } from "./LoadingSpinner";
import { showToast } from "./Toaster";
import { getWeekNumber } from "common/dateUtils";
import { useKIChat } from "../ki/ki-api";
import { useCreateArbeidsplan, type StudyBlock } from "../arbeidsplan/arbeidsplan-api";
import { PRIORITY_COLORS, DAYS_ORDER, PRIORITY_LABELS } from "../arbeidsplan/arbeidsplan-api";

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

export function WeeklyPlanSuggestions({ assignments, onPlanCreated }: WeeklyPlanSuggestionsProps) {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const isMountedRef = useRef(true);
  
  const { sendMelding } = useKIChat();
  const createMutation = useCreateArbeidsplan();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Generer ukeplan med EKTE Claude AI
  const generatePlan = () => {
    setIsGenerating(true);
    setError(null);
    setPlan(null);
    setSelectedBlocks(new Set());

    // Sorter oppgaver etter frist
    const sortedAssignments = [...assignments]
      .filter(a => a.dueAt)
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());

    if (sortedAssignments.length === 0) {
      if (isMountedRef.current) {
        setError("Ingen oppgaver med frister funnet. Legg til oppgaver i Canvas først.");
        setIsGenerating(false);
      }
      return;
    }

    // Bygg prompt med alle oppgaver
    const assignmentList = sortedAssignments.slice(0, 10).map(a => {
      const daysUntil = Math.ceil((new Date(a.dueAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return `- ${a.name} (${a.courseName || "Ukjent emne"}) - Frist: om ${daysUntil} dager${a.pointsPossible ? `, ${a.pointsPossible} poeng` : ''}`;
    }).join('\n');

    const prompt = `Du er en ekspert studierådgiver. Analyser følgende oppgaver og lag en optimal ukeplan for studenten.

OPPGAVER:
${assignmentList}

DAGENS DATO: ${new Date().toLocaleDateString("nb-NO")}
UKENUMMER: ${getWeekNumber(new Date())}

INSTRUKSJONER:
1. Fordel oppgavene smart over uken (Mandag til Søndag)
2. Prioriter oppgaver med nærmeste frister først
3. Bruk realistiske tidslots (08:00-10:00, 10:00-12:00, 13:00-15:00, 15:00-17:00, 17:00-19:00, 19:00-21:00)
4. Variert duration basert på oppgavens størrelse: "1 timer", "1.5 timer", "2 timer", "2.5 timer", "3 timer"
5. Sett priority: "high" (frist ≤3 dager), "medium" (4-7 dager), "low" (>7 dager)
6. Gi 3-5 personlige studietips basert på studentens situasjon
7. Ikke overlap oppgaver - kun én oppgave per tidslot
8. Fordel belastningen jevnt - unngå for mange oppgaver samme dag
9. Bruk norske dagnavn: Mandag, Tirsdag, Onsdag, Torsdag, Fredag, Lørdag, Søndag

Svar KUN med et JSON-objekt i dette formatet (ingen ekstra tekst):
{
  "blocks": [
    {
      "day": "Mandag",
      "timeSlot": "08:00-10:00",
      "task": "Oppgavenavn",
      "duration": "2 timer",
      "priority": "high",
      "courseName": "Emnekode",
      "completed": false
    }
  ],
  "tips": [
    "Tips 1",
    "Tips 2",
    "Tips 3"
  ]
}`;

    sendMelding(
      [{ role: "user", content: prompt }],
      {
        temperature: 0.7,
        onSuccess: (data) => {
          try {
            // Parse Claude's response
            let jsonText = data.response;
            
            // Fjern markdown code blocks hvis de finnes
            jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            
            const parsed = JSON.parse(jsonText);
            
            if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
              throw new Error("Invalid response format");
            }

            // Valider og normaliser blocks
            const blocks: StudyBlock[] = parsed.blocks.map((block: any) => ({
              day: block.day || "Mandag",
              timeSlot: block.timeSlot || "08:00-10:00",
              task: block.task || "Ukjent oppgave",
              duration: block.duration || "1.5 timer",
              priority: (block.priority as "high" | "medium" | "low") || "medium",
              courseName: block.courseName || "Ukjent emne",
              completed: false,
            }));

            const tips = parsed.tips || [
              "Start med høyprioritet oppgaver tidlig på dagen",
              "Ta pauser hver time for å bevare konsentrasjonen",
              "Bruk Pomodoro-teknikk for effektiv studietid",
            ];

            // Beregn totale timer
            const totalHours = blocks.reduce((sum, block) => {
              const match = block.duration.match(/(\d+\.?\d*)/);
              const hours = match ? parseFloat(match[1]) : 1.5;
              return sum + hours;
            }, 0);

            if (!isMountedRef.current) return;
            
            const now = new Date();
            setPlan({
              week: `Uke ${getWeekNumber(now)}, ${now.getFullYear()}`,
              totalHours,
              blocks,
              tips,
            });
            setIsGenerating(false);
            showToast.success(`Claude genererte en ukeplan med ${blocks.length} studieøkter!`);
          } catch (error) {
            console.error("Failed to parse AI response:", error);
            setIsGenerating(false);
            setError("Kunne ikke tolke AI-responsen. Prøv igjen.");
          }
        },
        onError: (error) => {
          console.error("AI generation failed:", error);
          setIsGenerating(false);
          setError("KI-generering feilet. Sjekk at du har oppgaver med frister i Canvas.");
        },
      }
    );
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

    // Beregn totale timer for valgte blokker
    const totalHours = selectedBlocksArray.reduce((sum, block) => {
      const match = block.duration.match(/(\d+\.?\d*)/);
      const hours = match ? parseFloat(match[1]) : 1.5;
      return sum + hours;
    }, 0);

    try {
      await createMutation.mutateAsync({
        week: plan.week,
        weekNumber,
        year,
        blocks: selectedBlocksArray,
        totalHours,
      });

      showToast.success("Arbeidsplan lagret!");
      onPlanCreated?.();
      
      // Reset
      setPlan(null);
      setSelectedBlocks(new Set());
    } catch (err) {
      console.error("Failed to save plan:", err);
      showToast.error("Kunne ikke lagre arbeidsplan. Prøv igjen.");
    }
  };

  // Initial state - no plan generated
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
              La Claude AI analysere dine Canvas-oppgaver og lage en optimal studieukeplan.
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

  // Loading state
  if (isGenerating) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-12">
        <div className="text-center space-y-4">
          <LoadingSpinner className="w-12 h-12" />  
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Claude AI genererer ukeplan...
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Analyserer oppgaver, frister og kompleksitet
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
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

  // Group blocks by day
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
                Legg til i min plan ({selectedBlocks.size})
              </>
            )}
          </button>
        </div>
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
                    {dayBlocks.length} {dayBlocks.length === 1 ? 'oppgave' : 'oppgaver'}
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

      {/* Tips from Claude AI */}
      {plan.tips && plan.tips.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-300 mb-2">
                Studietips fra Claude AI
              </h4>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                {plan.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
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
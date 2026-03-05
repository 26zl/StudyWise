/*
 * ModulForklaring - KI-drevet forklaring av modulinnhold
 * Bruker Claude AI til å forklare hva en modul handler om basert på items
 */
"use client";

import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useKIChat } from "../ki/ki-api";

interface ModulItem { 
  id: number;
  title: string;
  type: string;
  indent?: number;
}

interface CanvasModule {
  id: number;
  name: string;
  items?: ModulItem[];
}

interface ModulForklaringProps {
  module: CanvasModule;
  courseName: string;
}

export function ModulForklaring({ module, courseName }: ModulForklaringProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const { sendMelding } = useKIChat();

  const generateExplanation = () => {
    if (explanation) {
      // Hvis vi allerede har en forklaring, bare toggle expand
      setIsExpanded(!isExpanded);
      return;
    }

    setIsGenerating(true);
    setIsExpanded(true);

    // Bygg en strukturert beskrivelse av modulen
    const itemsList = module.items && module.items.length > 0
      ? module.items.map(item => `- ${item.title} (${item.type})`).join('\n')
      : 'Ingen items tilgjengelig';

    const prompt = `Som student vil jeg kunne be KI forklare et begrep fra modulinnholdet slik at jeg lærer uten å miste kontekst.

Modul: "${module.name}"
Emne: "${courseName}"

Innhold i modulen:
${itemsList}

Gi meg en kort, studentvennlig forklaring (2-3 setninger) om hva denne modulen handler om og hva jeg kommer til å lære. Fokuser på læringsverdien.`;

    // Bruk callbacks siden sendMelding returnerer void
    sendMelding(
      [{ role: "user", content: prompt }],
      {
        onSuccess: (data) => {
          if (data?.response) {
            setExplanation(data.response);
          } else {
            setExplanation("Kunne ikke generere forklaring. Prøv igjen senere.");
          }
          setIsGenerating(false);
        },
        onError: (error) => {
          console.error("Feil ved generering av forklaring:", error);
          setExplanation("En feil oppstod. Prøv igjen senere.");
          setIsGenerating(false);
        },
      }
    );
  };

  return (
    <div className="mt-3 mb-2">
      <button
        onClick={generateExplanation}
        disabled={isGenerating}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
            {explanation ? "KI-forklaring" : "Få KI-forklaring"}
          </span>
        </div>
        
        {isGenerating ? (
          <Loader2 className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-spin" />
        ) : (
          isExpanded ? (
            <ChevronUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          )
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-top-1 duration-200">
          {isGenerating ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Genererer forklaring...</span>
            </div>
          ) : explanation ? (
            <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed m-0">
                {explanation}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
} 
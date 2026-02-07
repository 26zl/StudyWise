"use client";

import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";

interface SmartSuggestionsProps {
  lastAIMessage: string;
  onSelectSuggestion: (suggestion: string) => void;
  disabled?: boolean;
}

export function SmartSuggestions({
  lastAIMessage,
  onSelectSuggestion,
  disabled = false,
}: SmartSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!lastAIMessage) return;

    // Generer suggestions basert på AI's siste svar
    const newSuggestions: string[] = [];

    // Kontekst-baserte suggestions
    const lowerMessage = lastAIMessage.toLowerCase();
    
    if (lowerMessage.includes("modul") || lowerMessage.includes("forelesning")) {
      newSuggestions.push("Vis meg neste modul");
      newSuggestions.push("Hva er pensum for denne modulen?");
    } else if (lowerMessage.includes("oppgave") || lowerMessage.includes("innlevering")) {
      newSuggestions.push("Hva er fristen?");
      newSuggestions.push("Hjelp meg å starte");
    } else if (lowerMessage.includes("eksamen")) {
      newSuggestions.push("Gi meg studietips");
      newSuggestions.push("Hva bør jeg fokusere på?");
    } else if (lowerMessage.match(/\d+\.\s/g) && lowerMessage.match(/\d+\.\s/g).length >= 3) {
      // AI ga en liste - tilby å utdype punkter
      newSuggestions.push("Forklar punkt 1 mer detaljert");
      newSuggestions.push("Gi meg eksempler");
    } else if (lowerMessage.includes("```")) { 
      // AI ga kodeeksempel
      newSuggestions.push("Forklar koden linje for linje");
      newSuggestions.push("Gi meg et lignende eksempel");
    }

    // Alltid tilgjengelige suggestions
    if (newSuggestions.length < 3) {
      newSuggestions.push("Fortsett...");
      newSuggestions.push("Forklar enklere");
    }

    setSuggestions(newSuggestions.slice(0, 3));
  }, [lastAIMessage]);

  if (suggestions.length === 0) return null;

  return (
    <div className="flex items-start gap-2 py-3 border-t border-slate-200 dark:border-slate-800">
      <Sparkles className="w-4 h-4 text-purple-500 mt-1 shrink-0" />
      <div className="flex-1">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          Forslag til oppfølging:
        </p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => onSelectSuggestion(suggestion)}
              disabled={disabled}
              className="px-3 py-1.5 text-xs rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}  
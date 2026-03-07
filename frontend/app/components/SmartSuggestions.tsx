"use client";

// SmartSuggestions-komponenten genererer og viser smarte forslag basert på den siste AI-meldingen
import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";

// Props for SmartSuggestions-komponenten
interface SmartSuggestionsProps {
  lastAIMessage: string;
  onSelectSuggestion: (suggestion: string) => void;
  disabled?: boolean;
}
// Komponent for å vise smarte forslag basert på den siste AI-meldingen
export function SmartSuggestions({
  lastAIMessage,
  onSelectSuggestion,
  disabled = false,
}: SmartSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
// Bruk useEffect for å oppdatere forslagene hver gang den siste AI-meldingen endres
  useEffect(() => {
    if (!lastAIMessage || lastAIMessage.trim() === "") {
      setSuggestions([]);
      return;
    }

    // Enkle heuristikker for å generere relevante forslag basert på innholdet i AI-meldingen
    const newSuggestions: string[] = [];
    const lowerMessage = lastAIMessage.toLowerCase();

    // Eksempler på heuristikker:
    if (lowerMessage.includes("modul") || lowerMessage.includes("forelesning")) {
      newSuggestions.push("Vis meg neste modul");
      newSuggestions.push("Hva er pensum for denne modulen?");
    } else if (lowerMessage.includes("oppgave") || lowerMessage.includes("innlevering")) {
      newSuggestions.push("Hva er fristen?");
      newSuggestions.push("Hjelp meg å starte");
    } else if (lowerMessage.includes("eksamen")) {
      newSuggestions.push("Gi meg studietips");
      newSuggestions.push("Hva bør jeg fokusere på?");
    } else {
      const listeMatch = lowerMessage.match(/\d+\.\s/g);
      if (listeMatch && listeMatch.length >= 3) {
        newSuggestions.push("Forklar punkt 1 mer detaljert");
        newSuggestions.push("Gi meg eksempler");
      } else if (lowerMessage.includes("```")) {
        newSuggestions.push("Forklar koden linje for linje");
        newSuggestions.push("Gi meg et lignende eksempel");
      }
    }
    // Hvis heuristikkene ikke gir nok forslag, legg til noen generiske forslag
    if (newSuggestions.length < 3) {
      newSuggestions.push("Fortsett...");
      newSuggestions.push("Forklar enklere");
    }
    // Begrens antall forslag til 3
    setSuggestions(newSuggestions.slice(0, 3));
  }, [lastAIMessage]);
  if (suggestions.length === 0) return null;
// Render forslagene
  return (
    <div className="py-3 px-4 md:px-6">
      <div className="max-w-[940px] mx-auto flex items-start gap-2">
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
    </div>
  );
}
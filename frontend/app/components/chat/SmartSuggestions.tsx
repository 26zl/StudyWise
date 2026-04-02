"use client";

/*
 * SmartSuggestions – kontekstbevisste oppfølgingsforslag i KI-chatten.
 * Smarte oppfølgingsspørsmål (#35): forslag basert på svarets innhold/kategori.
 * Auto-genererte modulspørsmål (#12): foreslår spørsmål om emner/emnekoder nevnt i samtalen.
 */
import { useState, useEffect, useMemo } from "react";
import { Sparkles, BookOpen, Lightbulb } from "lucide-react";
import { useLanguage } from "@/app/i18n";

interface SmartSuggestionsProps {
  lastAIMessage: string;
  onSelectSuggestion: (suggestion: string) => void;
  disabled?: boolean;
}

// --- Kategorisering av AI-svar ---

type ResponseCategory = "kode" | "liste" | "oppgave" | "forklaring" | "planlegging" | "oppsummering" | "generelt";

function categorizeResponse(text: string): ResponseCategory {
  if (/```/.test(text)) return "kode";
  if ((text.match(/\d+\.\s/g) || []).length >= 3) return "liste";
  if (/oppsummer|sammendrag|kort fortalt|hovedpunkt/i.test(text)) return "oppsummering";
  if (/frist|deadline|innlevering|eksamen|dato/i.test(text)) return "oppgave";
  if (/plan|uke|tid|fordel|prioriter|studie/i.test(text)) return "planlegging";
  if (/betyr|definisjon|konsept|forklaring|forstå|prinsipp/i.test(text)) return "forklaring";
  return "generelt";
}

// --- Kategoribaserte oppfølgingsforslag (#35) — bygges via i18n inne i komponenten ---

// --- Modulspørsmål (#12) ---

/** Finn emnekoder som DAPE1400, TDT4100 etc. */
function extractModules(text: string): string[] {
  const matches = text.match(/\b[A-ZÆØÅ]{2,4}\d{4}\b/g);
  return [...new Set(matches || [])].slice(0, 2);
}

/** Finn fagområder nevnt i teksten */
function detectTopic(text: string): string | null {
  const lower = text.toLowerCase();
  const topics: [RegExp, string][] = [
    [/programm|kode|variabel|funksjoner?|class|objekt|loop|array|algoritm/, "programmering"],
    [/matematikk|integral|derivasjon|ligning|kalkulus|statistikk/, "matematikk"],
    [/database|sql|tabell|relasjon|normalis/, "databaser"],
    [/nettverk|protokoll|tcp|http|server|klient/, "nettverk"],
    [/design|ux|ui|brukergrensesnitt|wireframe/, "design"],
    [/prosjekt|scrum|agil|sprint|backlog/, "prosjektledelse"],
  ];
  for (const [pattern, topic] of topics) {
    if (pattern.test(lower)) return topic;
  }
  return null;
}

type SuggestionType = "followup" | "module" | "hint";

export function SmartSuggestions({
  lastAIMessage,
  onSelectSuggestion,
  disabled = false,
}: SmartSuggestionsProps) {
  const { t } = useLanguage();
  const [suggestions, setSuggestions] = useState<{ text: string; type: SuggestionType }[]>([]);

  const FOLLOW_UPS = useMemo((): Record<ResponseCategory, string[]> => ({
    kode: [t("smartSuggestions.kode0"), t("smartSuggestions.kode1"), t("smartSuggestions.kode2")],
    liste: [t("smartSuggestions.liste0"), t("smartSuggestions.liste1"), t("smartSuggestions.liste2")],
    forklaring: [t("smartSuggestions.forklaring0"), t("smartSuggestions.forklaring1"), t("smartSuggestions.forklaring2")],
    oppgave: [t("smartSuggestions.oppgave0"), t("smartSuggestions.oppgave1"), t("smartSuggestions.oppgave2")],
    planlegging: [t("smartSuggestions.planlegging0"), t("smartSuggestions.planlegging1"), t("smartSuggestions.planlegging2")],
    oppsummering: [t("smartSuggestions.oppsummering0"), t("smartSuggestions.oppsummering1"), t("smartSuggestions.oppsummering2")],
    generelt: [t("smartSuggestions.generelt0"), t("smartSuggestions.generelt1"), t("smartSuggestions.generelt2")],
  }), [t]);

  const analysis = useMemo(() => {
    if (!lastAIMessage?.trim()) return null;
    return {
      category: categorizeResponse(lastAIMessage),
      modules: extractModules(lastAIMessage),
      topic: detectTopic(lastAIMessage),
    };
  }, [lastAIMessage]);

  useEffect(() => {
    if (!analysis) {
      setSuggestions([]);
      return;
    }

    const { category, modules, topic } = analysis;
    const result: { text: string; type: SuggestionType }[] = [];
    const seen = new Set<string>();

    const add = (text: string, type: SuggestionType) => {
      if (!seen.has(text) && result.length < 4) {
        seen.add(text);
        result.push({ text, type });
      }
    };

    // 1. Kontekstbaserte oppfølginger (#35) — 2 stk
    for (const fu of FOLLOW_UPS[category].slice(0, 2)) {
      add(fu, "followup");
    }

    // 2. Modulspørsmål (#12) — 1 stk hvis emnekode eller fagområde nevnt
    if (modules.length > 0) {
      add(t("smartSuggestions.moduleExercises", { module: modules[0] }), "module");
    } else if (topic) {
      add(t("smartSuggestions.topicConcepts", { topic }), "module");
    }

    // 3. Fyll opp med generiske hints
    for (const g of [t("smartSuggestions.genericHint0"), t("smartSuggestions.genericHint1")]) {
      add(g, "hint");
    }

    setSuggestions(result.slice(0, 3));
  }, [analysis, FOLLOW_UPS, t]);

  if (suggestions.length === 0) return null;

  const getIcon = (type: SuggestionType) => {
    if (type === "module") return <BookOpen className="w-3 h-3 mr-1 inline-block opacity-60" />;
    if (type === "hint") return <Lightbulb className="w-3 h-3 mr-1 inline-block opacity-60" />;
    return null;
  };

  return (
    <div className="py-3 px-4 md:px-6">
      <div className="max-w-[940px] mx-auto flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-purple-500 mt-1 shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            {t("smartSuggestions.followupLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectSuggestion(s.text)}
                disabled={disabled}
                className={`px-3 py-1.5 text-xs rounded-full border bg-white dark:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  s.type === "module"
                    ? "border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                }`}
              >
                {getIcon(s.type)}
                {s.text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
} 

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { KIOppsummering } from "@/app/components/ki/KIOppsummering";
import { useLanguage } from "@/app/i18n";
import { useUIStore } from "@/app/store/uiStore";

type CanvasKildeType = "announcement" | "assignment" | "module" | "page" | "event";

interface CanvasKIHandlingerProps {
  tekst: string;
  storrelse: "sm" | "md" | "lg";
  kildetype: CanvasKildeType;
  tittel?: string;
  emne?: string;
}

const MAKS_KI_INNHOLD_TEGN = 12_000;

const storrelser = {
  sm: {
    container: "mt-2 flex flex-wrap items-center gap-2",
    knapp: "px-2.5 py-1 text-xs",
    ikon: 14,
  },
  md: {
    container: "mt-3 flex flex-wrap items-center gap-2",
    knapp: "px-3 py-1.5 text-xs",
    ikon: 14,
  },
  lg: {
    container: "px-8 pb-6 flex flex-wrap items-center gap-2",
    knapp: "px-4 py-2 text-sm",
    ikon: 16,
  },
} as const;

function hentKildeEtikett(kildetype: CanvasKildeType, language: "nb" | "en") {
  const etiketter = {
    nb: {
      announcement: "kunngjøring",
      assignment: "oppgave",
      event: "hendelse",
      module: "modul",
      page: "side",
    },
    en: {
      announcement: "announcement",
      assignment: "assignment",
      event: "event",
      module: "module",
      page: "page",
    },
  } as const;

  return etiketter[language][kildetype];
}

function rensCanvasTekst(tekst: string) {
  const trimmet = tekst.trim();
  if (!trimmet) {
    return "";
  }

  if (typeof document === "undefined" || !/[<>]/.test(trimmet)) {
    return trimmet.replace(/\s+/g, " ").trim();
  }

  // Sanitér HTML først for å unngå XSS ved DOM-parsing, deretter hent ren tekst
  const sanitized = DOMPurify.sanitize(trimmet, { ALLOWED_TAGS: [] });
  return sanitized.replace(/\s+/g, " ").trim();
}

function lagPrompt({
  language,
  kildetype,
  tekst,
  tittel,
  emne,
}: {
  language: "nb" | "en";
  kildetype: CanvasKildeType;
  tekst: string;
  tittel?: string;
  emne?: string;
}) {
  const kildeEtikett = hentKildeEtikett(kildetype, language);
  const avkortetTekst =
    tekst.length > MAKS_KI_INNHOLD_TEGN
      ? `${tekst.slice(0, MAKS_KI_INNHOLD_TEGN)}${
          language === "en"
            ? "\n\n[Note: The Canvas content was truncated because it was very long.]"
            : "\n\n[Merk: Canvas-innholdet ble forkortet fordi det var veldig langt.]"
        }`
      : tekst;

  if (language === "en") {
    return [
      "You are StudyWise's AI assistant.",
      "Respond in English.",
      `I have opened a Canvas ${kildeEtikett} and want help based directly on the content below.`,
      "Give me:",
      "1. A short explanation of what this is about.",
      "2. The most important things I should notice as a student.",
      "3. Any deadlines, requirements, or actions mentioned.",
      "4. What I should do next.",
      "",
      "Context:",
      tittel ? `- Title: ${tittel}` : "",
      emne ? `- Course: ${emne}` : "",
      `- Source type: ${kildeEtikett}`,
      "",
      "Canvas content:",
      avkortetTekst,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Du er StudyWise sin KI-assistent.",
    "Svar på norsk bokmål.",
    `Jeg har åpnet en Canvas-${kildeEtikett} og vil ha hjelp direkte ut fra innholdet under.`,
    "Gi meg:",
    "1. En kort forklaring på hva dette handler om.",
    "2. Det viktigste jeg bør få med meg som student.",
    "3. Eventuelle frister, krav eller oppgaver som nevnes.",
    "4. Hva jeg bør gjøre videre.",
    "",
    "Kontekst:",
    tittel ? `- Tittel: ${tittel}` : "",
    emne ? `- Emne: ${emne}` : "",
    `- Kildetype: ${kildeEtikett}`,
    "",
    "Canvas-innhold:",
    avkortetTekst,
  ]
    .filter(Boolean)
    .join("\n");
}

export function CanvasKIHandlinger({
  tekst,
  storrelse,
  kildetype,
  tittel,
  emne,
}: CanvasKIHandlingerProps) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const requestNewChat = useUIStore((state) => state.requestNewChat);
  const setPendingKIMelding = useUIStore((state) => state.setPendingKIMelding);
  const [navigerer, setNavigerer] = useState(false);

  const rensetTekst = useMemo(() => rensCanvasTekst(tekst), [tekst]);
  const harTekst = rensetTekst.length > 0;
  const s = storrelser[storrelse];

  const handterKlikk = () => {
    if (!harTekst || navigerer) {
      return;
    }

    setNavigerer(true);
    requestNewChat();
    setPendingKIMelding({
      melding: lagPrompt({
        language,
        kildetype,
        tekst: rensetTekst,
        tittel,
        emne,
      }),
      skipCanvasValidation: true,
    });
    router.push("/dashboard");
  };

  return (
    <div className={s.container}>
      <KIOppsummering tekst={tekst} storrelse={storrelse} variant="inline" />
      <button
        type="button"
        onClick={handterKlikk}
        disabled={!harTekst || navigerer}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 ${s.knapp}`}
      >
        {navigerer ? (
          <Loader2 size={s.ikon} className="animate-spin" />
        ) : (
          <MessageSquarePlus size={s.ikon} />
        )}
        {t("common.actions.askAi")}
      </button>
    </div>
  );
}

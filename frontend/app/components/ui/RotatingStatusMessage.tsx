/**
 * Roterende statusmelding under lange KI-operasjoner (chat, quiz, flashcards).
 *
 * Hvorfor: Claude-svar tar 5-150 sek for kompleks kontekst. Uten tilbakemelding
 * tror brukeren at appen har frosset — særlig på mobil. Denne komponenten
 * viser en rullerende melding som forteller hva som skjer, gir et nyttig fakta,
 * motiverer, eller foreslår en pause — slik at ventetiden føles kortere og
 * mer meningsfull.
 *
 * Forvaltning:
 * - Meldingene ligger i `loadingMessages.ts` og er universelle (ikke domene-
 *   spesifikke). Legg gjerne til nye entries der uten kode-endring her.
 * - Pauser automatisk når fanen er i bakgrunnen (sparer re-renders).
 */
"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  buildMessagePool,
  type LoadingMessageCategory,
} from "./loadingMessages";

// Stabil referanse for default-kategorier. Uten denne ville `categories = []`
// i parameterlista laget et nytt array på hver render, og `useMemo` i
// komponenten ville rebuild-et (og stokket) poolen hver gang — som ga
// tilfeldige meldingssprang i stedet for planlagt rotasjon.
const INGEN_KATEGORIER: readonly LoadingMessageCategory[] = Object.freeze([]);

export interface RotatingStatusMessageProps {
  /**
   * Velg hvilke kategorier som skal være med i rullerings-poolen.
   * Tom eller utelatt = alle kategorier (status, visste-du-at, motivasjon, pause).
   */
  categories?: LoadingMessageCategory[];
  /**
   * Hvor lenge hver melding vises før neste. Default 5500 ms.
   *
   * 5.5 sek er valgt bevisst: kort nok til at brukeren ser at noe skjer,
   * langt nok til at teksten rekkes å leses og bytte ikke virker
   * forhastet/useriøst. Tidligere 4000 ms ga "flikker"-inntrykk på
   * lengre meldinger (visste-du-at-fakta).
   */
  intervalMs?: number;
  /** Valgfri CSS-klasse for ytre container. */
  className?: string;
  /**
   * Aktivér/deaktivér visning. Komponenten returnerer null hvis false —
   * caller kan bruke samme loading-boolean for både eksisterende spinner
   * og denne.
   */
  active?: boolean;
}

export function RotatingStatusMessage({
  categories,
  intervalMs = 5500,
  className = "",
  active = true,
}: RotatingStatusMessageProps) {
  // Bygg og stokk poolen én gang per mount slik at rekkefølgen er tilfeldig
  // for hver loading-session, men stabil under rendringene. Vi memoer på
  // *innholdet* (sortert join) i stedet for array-referansen, så callere
  // som sender `categories={["status"]}` inline ikke forårsaker re-stokk.
  const effektiveKategorier = categories ?? INGEN_KATEGORIER;
  const katKey = useMemo(
    () => [...effektiveKategorier].sort().join("|"),
    [effektiveKategorier],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => buildMessagePool([...effektiveKategorier]), [katKey]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active) return;
    const handleVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [active]);

  useEffect(() => {
    if (!active || paused || pool.length === 0) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % pool.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, paused, pool.length, intervalMs]);

  if (!active || pool.length === 0) return null;

  const message = pool[index];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`min-h-5 text-xs text-slate-500 dark:text-slate-400 ${className}`.trim()}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="inline-block"
        >
          {message}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/*
 * Skjemaer og typer for aktivitetssporing (studietid utenfor chat-meldinger).
 *
 * Frontend sender heartbeats hvert 60. sekund mens brukeren er aktiv (synlig fane +
 * mus/tastatur/scroll siste 2 minutter). Backend slår nabo-heartbeats sammen til én
 * åpen økt og lagrer som ActivityLog-intervaller. Se backend/rutere/auth/brukerAuth.ts
 * for endpoint og backend/database/models/ActivityLog.ts for lagringsmodell.
 */
import { z } from "zod";

export const ACTIVITY_TYPES = [
  "chat",
  "oversikt",
  "kalender",
  "canvas",
  "bokmerker",
  "quiz",
  "flashcards",
  "arbeidsplan",
  "annet",
] as const;

export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/** Gap på mer enn dette tolkes som ny økt (dvs. brukeren var borte > 2 min). */
export const ACTIVITY_IDLE_THRESHOLD_MS = 2 * 60 * 1000;

/** Anbefalt heartbeat-frekvens i frontend. */
export const ACTIVITY_HEARTBEAT_INTERVAL_MS = 60 * 1000;

export const ActivityHeartbeatRequestSchema = z.object({
  type: ActivityTypeSchema,
});

export type ActivityHeartbeatRequest = z.infer<typeof ActivityHeartbeatRequestSchema>;

export const ActivityHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
});

export type ActivityHeartbeatResponse = z.infer<typeof ActivityHeartbeatResponseSchema>;

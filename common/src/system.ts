/**
 * System — delt skjema for systemstatus og globale admin-meldinger.
 *
 * - `DependenciesHealthSchema` matcher responsen fra `GET /health/dependencies`
 *   og brukes av admin-panelet til å rendre live status-indikator.
 * - `SystemAnnouncementSchema` er det globale banneret admin kan publisere til
 *   alle innloggede brukere (f.eks. "Chat-tjenesten er utilgjengelig").
 */

import { z } from "zod";

// ─── Avhengighetshelse ────────────────────────────────────────────────────────

export const DependencyStatusSchema = z.enum(["up", "down", "unknown"]);
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

const DependencyEntrySchema = z.object({
  ok: z.boolean().nullable(),
  status: DependencyStatusSchema,
  critical: z.boolean(),
});

export const DependenciesHealthSchema = z.object({
  ok: z.boolean(),
  type: z.literal("dependencies"),
  timestamp: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
  dependencies: z.object({
    mongo: DependencyEntrySchema,
    redis: DependencyEntrySchema,
    bullmq: DependencyEntrySchema,
    anthropic: DependencyEntrySchema,
    cohere: DependencyEntrySchema,
    clerk: DependencyEntrySchema,
    pinecone: DependencyEntrySchema,
  }),
});
export type DependenciesHealth = z.infer<typeof DependenciesHealthSchema>;

// ─── Global systemmelding ─────────────────────────────────────────────────────

export const SystemAnnouncementSeveritySchema = z.enum(["info", "warning", "critical"]);
export type SystemAnnouncementSeverity = z.infer<typeof SystemAnnouncementSeveritySchema>;

/**
 * Banneret som vises til alle innloggede brukere når admin har publisert.
 * Returneres fra GET /api/announcement — kun når det finnes en aktiv melding.
 */
export const SystemAnnouncementSchema = z.object({
  active: z.boolean(),
  severity: SystemAnnouncementSeveritySchema,
  melding: z.string().trim().min(1).max(500),
  oppdatertAt: z.iso.datetime(),
  dismissible: z.boolean().default(true),
});
export type SystemAnnouncement = z.infer<typeof SystemAnnouncementSchema>;

/** Respons fra GET /api/announcement når ingen aktiv melding finnes. */
export const NoActiveAnnouncementSchema = z.object({
  active: z.literal(false),
});

/** Kombinert respons: enten en aktiv melding eller en "ingen aktiv"-indikator. */
export const AnnouncementResponseSchema = z.union([
  SystemAnnouncementSchema,
  NoActiveAnnouncementSchema,
]);
export type AnnouncementResponse = z.infer<typeof AnnouncementResponseSchema>;

/**
 * Admin-respons fra GET /api/admin/announcement. Inneholder ALLTID alle felt
 * (selv om active=false) slik at admin-UI kan prefille skjemaet. Derfor tillater
 * `melding` tom streng her — kun når admin publiserer (POST) kreves min(1).
 */
export const AdminAnnouncementStateSchema = z.object({
  active: z.boolean(),
  severity: SystemAnnouncementSeveritySchema,
  melding: z.string().trim().max(500),
  oppdatertAt: z.iso.datetime(),
  dismissible: z.boolean(),
});
export type AdminAnnouncementState = z.infer<typeof AdminAnnouncementStateSchema>;

/** Input admin sender for å publisere/oppdatere banneret. */
export const PublishAnnouncementRequestSchema = z.object({
  severity: SystemAnnouncementSeveritySchema,
  melding: z.string().trim().min(1, "Meldingen kan ikke være tom").max(500, "Maks 500 tegn"),
  dismissible: z.boolean().default(true),
});
export type PublishAnnouncementRequest = z.infer<typeof PublishAnnouncementRequestSchema>;

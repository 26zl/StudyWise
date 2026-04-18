/**
 * System — delt skjema for systemstatus og globale admin-meldinger.
 *
 * - `DependenciesHealthSchema` matcher responsen fra `GET /health/dependencies`
 *   og brukes av admin-panelet til å rendre live status-indikator.
 * - `SystemAnnouncementSchema` er det globale banneret admin kan publisere til
 *   alle innloggede brukere (f.eks. "Chat-tjenesten er utilgjengelig").
 */

import { z } from "zod";

// ─── Vilkår/personvern-versjonering ───────────────────────────────────────────

/**
 * Gjeldende versjon av vilkår og personvernerklæring (dato-basert).
 *
 * BUMP-REGEL: Øk denne datoen hver gang innholdet på /vilkar eller /personvern
 * endres på en måte som påvirker brukeren. Ved bump vil alle innloggede brukere
 * med eldre `termsVersionAccepted` få en re-aksept-modal før de kan fortsette
 * å bruke tjenesten.
 *
 * HISTORIKK: Tidligere tekst er bevart i git-historikk for frontend/app/vilkar
 * og frontend/app/personvern — kombinert med audit-entry `TERMS_ACCEPTED`
 * (versjon + tidsstempel + IP) gir dette juridisk bevis for nøyaktig hva
 * hver bruker godtok ved sin aksept.
 */
export const TERMS_VERSION = "2026-04-18";

/** Schema for POST /api/user/accept-terms. */
export const AcceptTermsRequestSchema = z.object({
  version: z.string().min(1),
});
export type AcceptTermsRequest = z.infer<typeof AcceptTermsRequestSchema>;

export const AcceptTermsResponseSchema = z.object({
  success: z.literal(true),
  termsVersionAccepted: z.string(),
  termsAcceptedAt: z.iso.datetime(),
});
export type AcceptTermsResponse = z.infer<typeof AcceptTermsResponseSchema>;

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
 * Returneres fra GET /api/announcement — kun når det finnes en aktiv melding
 * som har `showInBanner: true` (endepunktet filtrerer på server).
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
  showInBanner: z.boolean(),
  showOnStatusPage: z.boolean(),
});
export type AdminAnnouncementState = z.infer<typeof AdminAnnouncementStateSchema>;

/**
 * Matcher HTML-tagger slik at vi kan avvise meldinger som inneholder det.
 * Meldingen rendres i dag trygt som ren tekst i React (auto-escape), men hvis
 * meldingen senere brukes i e-post, push-varsler eller et `dangerouslySetInnerHTML`
 * et annet sted, kunne HTML i teksten åpnet for XSS. Å avvise ved input er
 * defense-in-depth — admin rephraser i stedet. Tillater fortsatt bare-tegnene
 * `<` og `>` (f.eks. "forsinkelse > 5 min").
 */
const HTML_TAG_REGEX = /<\/?[a-z][^>]*>/i;

/**
 * Input admin sender for å publisere/oppdatere banneret. Minst ett av
 * `showInBanner` / `showOnStatusPage` må være true — validert på server.
 */
export const PublishAnnouncementRequestSchema = z
  .object({
    severity: SystemAnnouncementSeveritySchema,
    melding: z
      .string()
      .trim()
      .min(1, "Meldingen kan ikke være tom")
      .max(500, "Maks 500 tegn")
      .refine(
        (s) => !HTML_TAG_REGEX.test(s),
        "Meldingen kan ikke inneholde HTML-tagger. Bruk ren tekst.",
      ),
    dismissible: z.boolean().default(true),
    showInBanner: z.boolean().default(true),
    showOnStatusPage: z.boolean().default(true),
  })
  .refine((data) => data.showInBanner || data.showOnStatusPage, {
    message: "Meldingen må vises minst ett sted (banner eller status-side).",
    path: ["showInBanner"],
  });
export type PublishAnnouncementRequest = z.infer<typeof PublishAnnouncementRequestSchema>;

// ─── Offentlig status-side ────────────────────────────────────────────────────

/** Samlet status for hele plattformen eller en enkelt komponent. */
export const OverallStatusSchema = z.enum(["operational", "degraded", "down"]);
export type OverallStatus = z.infer<typeof OverallStatusSchema>;

/**
 * Public status-respons som rendres på /status-siden. Viser brukerrettede
 * komponenter (Innlogging, KI-chat, Kunnskapsbase, Varsler) i stedet for
 * bakenforliggende teknologi, slik at vi ikke unødvendig avslører
 * infrastruktur-detaljer offentlig. Admin-panelet har fortsatt tilgang til
 * full tjeneste-status via `/health/dependencies`.
 *
 * En komponent er "down" hvis en kritisk underliggende tjeneste er nede,
 * "degraded" hvis bare ikke-kritiske tjenester er nede, ellers "operational".
 */
const ComponentEntrySchema = z.object({
  status: OverallStatusSchema,
});

export const PublicStatusResponseSchema = z.object({
  overall: OverallStatusSchema,
  timestamp: z.iso.datetime(),
  components: z.object({
    authentication: ComponentEntrySchema,
    aiChat: ComponentEntrySchema,
    knowledgeBase: ComponentEntrySchema,
    notifications: ComponentEntrySchema,
  }),
  announcement: z
    .object({
      severity: SystemAnnouncementSeveritySchema,
      melding: z.string(),
      oppdatertAt: z.iso.datetime(),
    })
    .nullable(),
});
export type PublicStatusResponse = z.infer<typeof PublicStatusResponseSchema>;

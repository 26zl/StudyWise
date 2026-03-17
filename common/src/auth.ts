/**
 * Auth – Zod-schemas og typer for auth API (Clerk, /me, preferanser, varsler).
 */

import { z } from "zod";
import { CANVAS_INSTITUSJONER_NORGE } from "./canvasInstitutions.js";

export function normalizeCanvasBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "").toLowerCase();
}

/** E-post canonicalisert: trim + lowercase, så backend ikke trenger egen normalisering. */
export const EmailSchema = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Ugyldig e-post"));

/** Gyldig Canvas base URL for StudyWise sin Canvas-integrasjon. */
const CANVAS_INSTRUCTURE_HOST_REGEX = /^([a-z0-9-]+\.)?instructure\.com$/i;
const CANVAS_BASE_URL_REGEX = /^https:\/\/([^/?#]+)\/?$/i;

function extractCanvasHostname(url: string): string | null {
  const match = url.match(CANVAS_BASE_URL_REGEX);
  return match?.[1]?.toLowerCase() ?? null;
}

const KJENTE_CANVAS_HOSTS = new Set(
  CANVAS_INSTITUSJONER_NORGE.map((inst) => extractCanvasHostname(inst.url)).filter(
    (hostname): hostname is string => hostname !== null,
  ),
);

function isAllowedCanvasBaseUrl(url: string): boolean {
  const hostname = extractCanvasHostname(url);
  if (!hostname) {
    return false;
  }

  return (
    CANVAS_INSTRUCTURE_HOST_REGEX.test(hostname) ||
    KJENTE_CANVAS_HOSTS.has(hostname)
  );
}

export const CanvasBaseUrlSchema = z
  .string()
  .trim()
  .check(z.url({ message: "Ugyldig Canvas-URL" }))
  .refine((url) => isAllowedCanvasBaseUrl(url), {
    message: "Må være en kjent Canvas-instans (f.eks. https://mitt.uib.no eller https://usn.instructure.com)",
  })
  .transform(normalizeCanvasBaseUrl);

// Request schema for lagring av Canvas token (canonicalisert: trim; tom streng/whitespace avvises)
export const CanvasTokenRequestSchema = z.object({
  token: z.string().trim().min(1, "Token kan ikke være tom"),
  /** Påkrevd: hvilken Canvas-instans tokenet gjelder (multi-tenant). */
  canvasBaseUrl: CanvasBaseUrlSchema,
});

/** Respons ved lagring/sletting av Canvas-token. Må inneholde success, feil eller canvasKonflikt slik at {} ikke er gyldig. */
export const CanvasTokenResponseSchema = z
  .object({
    melding: z.string().optional(),
    success: z.literal(true).optional(),
    feil: z.string().optional(),
    canvasKonflikt: z.boolean().optional(),
  })
  .refine(
    (d) => d.success === true || (d.feil != null && d.feil !== "") || d.canvasKonflikt === true,
    { message: "Respons må inneholde success, feil eller canvasKonflikt" },
  );

// Canvas kontekst preferanser
export const CanvasContextPreferencesSchema = z.object({
  announcements: z.boolean(),
  courses: z.boolean(),
  assignments: z.boolean(),
  events: z.boolean(),
});

/** RBAC: kun vanlig bruker og admin. */
export const APP_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof APP_ROLES)[number];
export const RoleSchema = z.enum(APP_ROLES);

/** Maks antall varsel-IDs per liste (lestIds / toastVistIds) – brukes i schema, frontend og backend. */
export const VARSLER_MAX_IDS = 500;

export const VarslerStateSchema = z.object({
  lestIds: z.array(z.string()).max(VARSLER_MAX_IDS, `Maks ${VARSLER_MAX_IDS} varsel-IDs`),
  toastVistIds: z.array(z.string()).max(VARSLER_MAX_IDS, `Maks ${VARSLER_MAX_IDS} varsel-IDs`),
});

export type CanvasContextPreferences = z.infer<typeof CanvasContextPreferencesSchema>;
export type VarslerState = z.infer<typeof VarslerStateSchema>;

export const DEFAULT_CANVAS_CONTEXT_PREFERENCES: CanvasContextPreferences = {
  announcements: true,
  courses: true,
  assignments: true,
  events: true,
};

export function createDefaultCanvasContextPreferences(): CanvasContextPreferences {
  return { ...DEFAULT_CANVAS_CONTEXT_PREFERENCES };
}

export function createDefaultVarslerState(): VarslerState {
  return {
    lestIds: [],
    toastVistIds: [],
  };
}

export function normalizeVarslerState(
  varslerState?: {
    lestIds?: readonly string[];
    toastVistIds?: readonly string[];
  } | null,
): VarslerState {
  const lest = varslerState?.lestIds ?? [];
  const toast = varslerState?.toastVistIds ?? [];

  return VarslerStateSchema.parse({
    lestIds: Array.from(new Set(lest)).slice(-VARSLER_MAX_IDS),
    toastVistIds: Array.from(new Set(toast)).slice(-VARSLER_MAX_IDS),
  });
}

export const PreferencesUpdateSchema = z
  .object({
    canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
    varslerState: VarslerStateSchema.optional(),
  })
  .refine(
    (data) =>
      data.canvasContextPreferences !== undefined ||
      data.varslerState !== undefined,
    "Ingen preferanser oppgitt",
  );

// Auth bruker (lokal)
export const AuthBrukerSchema = z.object({
  id: z.string(),
  email: EmailSchema,
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  hasCanvasToken: z.boolean(),
  /** Canvas base URL for brukerens institusjon (multi-tenant). */
  canvasBaseUrl: CanvasBaseUrlSchema.optional().nullable(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
  varslerState: VarslerStateSchema.optional(),
  /** RBAC-rolle (user, admin). */
  role: RoleSchema.optional(),
});

// Me / logout / preferences (Clerk-only; ingen lokale login/register/refresh-endepunkter)
export const MeResponseSchema = z.object({
  user: AuthBrukerSchema,
});
export const LogoutResponseSchema = z.object({
  melding: z.string(),
});

// Response schema for oppdatering av preferanser
export const PreferencesResponseSchema = z.object({
  melding: z.string(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
  varslerState: VarslerStateSchema.optional(),
});

export const AccountDeletionDeletedSchema = z.object({
  user: z.boolean(),
  chatHistory: z.number(),
  taskBreakdown: z.number(),
  contentEmbedding: z.number(),
  canvasUser: z.number(),
  arbeidsplan: z.number(),
});

export const AccountDeletionResponseSchema = z.object({
  melding: z.string(),
  deleted: AccountDeletionDeletedSchema,
  providerAccountDeleted: z.boolean(),
});

/** BroadcastChannel for auth-sync på tvers av faner (Clerk session). */
export const AUTH_CHANNEL_NAME = "studywise_auth_sync";

// CSRF: frontend sender denne headeren på POST/PUT/PATCH/DELETE; backend krever den for å avvise forespørsler fra tredjepartsider.
export const AUTH_CSRF_HEADER_NAME = "x-studywise-csrf";
export const AUTH_CSRF_HEADER_VALUE = "1";

// TypeScript typer eksportering
export type CanvasTokenRequest = z.infer<typeof CanvasTokenRequestSchema>;
export type CanvasTokenResponse = z.infer<typeof CanvasTokenResponseSchema>;
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;
export type AuthBruker = z.infer<typeof AuthBrukerSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;
export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponseSchema>;

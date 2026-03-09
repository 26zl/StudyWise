/*
 * Auth.ts
 * zod schemas for auth API
 */

import { z } from "zod";

/** E-post canonicalisert: trim + lowercase, så backend ikke trenger egen normalisering. */
export const EmailSchema = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Ugyldig e-post"));

// Request schema for lagring av Canvas token (canonicalisert: trim; tom streng/whitespace avvises)
export const CanvasTokenRequestSchema = z.object({
  token: z.string().trim().min(1, "Token kan ikke være tom"),
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

/** Maks antall varsel-IDs per liste (lestIds / toastVistIds) – brukes i schema, frontend og backend. */
export const VARSLER_MAX_IDS = 500;

export const VarslerStateSchema = z.object({
  lestIds: z.array(z.string()).max(VARSLER_MAX_IDS),
  toastVistIds: z.array(z.string()).max(VARSLER_MAX_IDS),
});

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
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  hasCanvasToken: z.boolean(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
  varslerState: VarslerStateSchema.optional(),
});

// Login/register/me/logout
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
// Register request schema
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: z
    .string()
    .min(8, "Passord må være minst 8 tegn")
    .regex(/[A-Z]/, "Passord må inneholde minst én stor bokstav")
    .regex(/[0-9]/, "Passord må inneholde minst ett tall"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
// Login response schema
export const LoginResponseSchema = z.object({
  melding: z.string(),
  user: AuthBrukerSchema,
});
// Register response schema
export const RegisterResponseSchema = z.object({
  melding: z.string(),
  userId: z.string(),
});
// Me response schema
export const MeResponseSchema = z.object({
  user: AuthBrukerSchema,
});
// Logout response schema
export const LogoutResponseSchema = z.object({
  melding: z.string(),
});
// Refresh response schema
export const RefreshResponseSchema = z.object({
  melding: z.string(),
});

// Response schema for oppdatering av preferanser
export const PreferencesResponseSchema = z.object({
  melding: z.string(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
  varslerState: VarslerStateSchema.optional(),
});

// Cookie-navn konstanter (delt mellom frontend og backend)
export const AUTH_COOKIE_NAME = "studywise_auth";
export const AUTH_REFRESH_COOKIE_NAME = "studywise_auth_refresh";
export const AUTH_CHANNEL_NAME = "studywise_auth_sync";

// CSRF: frontend sender denne headeren på POST/PUT/PATCH/DELETE; backend krever den for å avvise forespørsler fra tredjepartsider.
export const AUTH_CSRF_HEADER_NAME = "x-studywise-csrf";
export const AUTH_CSRF_HEADER_VALUE = "1";

// TypeScript typer eksportering
export type CanvasContextPreferences = z.infer<typeof CanvasContextPreferencesSchema>;
export type VarslerState = z.infer<typeof VarslerStateSchema>;
export type CanvasTokenRequest = z.infer<typeof CanvasTokenRequestSchema>;
export type CanvasTokenResponse = z.infer<typeof CanvasTokenResponseSchema>;
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;
export type AuthBruker = z.infer<typeof AuthBrukerSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

/*
 * Auth.ts
 * zod schemas for auth API
 */

import { z } from "zod";

const EmailSchema = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Ugyldig e-post");

// Request schema for lagring av Canvas token
export const CanvasTokenRequestSchema = z.object({
  token: z.string().min(1, "Token kan ikke vaere tom"),
});
// Response schema for lagring av Canvas token
export const CanvasTokenResponseSchema = z.object({
  melding: z.string().optional(),
  success: z.boolean().optional(),
  feil: z.string().optional(),
});

// Canvas kontekst preferanser
export const CanvasContextPreferencesSchema = z.object({
  announcements: z.boolean(),
  courses: z.boolean(),
  assignments: z.boolean(),
  events: z.boolean(),
});

// Auth bruker (lokal)
export const AuthBrukerSchema = z.object({
  id: z.string(),
  email: EmailSchema,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  hasCanvasToken: z.boolean(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
});

// Login/register/me/logout
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
// Register request schema
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8),
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
  canvasContextPreferences: CanvasContextPreferencesSchema,
});

// Cookie-navn konstanter (delt mellom frontend og backend)
export const AUTH_COOKIE_NAME = "studywise_auth";
export const AUTH_REFRESH_COOKIE_NAME = "studywise_auth_refresh";
export const AUTH_CHANNEL_NAME = "studywise_auth_sync";

// TypeScript typer eksportering
export type CanvasContextPreferences = z.infer<typeof CanvasContextPreferencesSchema>;
export type CanvasTokenRequest = z.infer<typeof CanvasTokenRequestSchema>;
export type CanvasTokenResponse = z.infer<typeof CanvasTokenResponseSchema>;
export type AuthBruker = z.infer<typeof AuthBrukerSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

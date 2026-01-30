/*
 * Auth.ts
 * zod schemas for auth API
 */

import { z } from "zod";

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

// Auth bruker (lokal)
export const AuthBrukerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  hasCanvasToken: z.boolean(),
});

// Login/register/me/logout
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
// Register request schema
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
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

// TypeScript typer eksportering
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

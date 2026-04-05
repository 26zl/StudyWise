/**
 * Auth – Zod-schemas og typer for auth API (Clerk, /me, preferanser, varsler).
 */

import { z } from "zod";
import { CANVAS_INSTITUSJONER_NORGE } from "./canvasInstitutions.js";
import { BrowserPushPreferencesSchema } from "./notifications.js";

export function normalizeCanvasBaseUrl(url: string): string {
  if (!url) return url;
  return url.trim().replace(/\/$/, "").toLowerCase();
}

/** E-post canonicalisert: trim + lowercase, så backend ikke trenger egen normalisering. */
export const EmailSchema = z
  .string()
  .trim()
  .max(320, "E-post kan ikke være mer enn 320 tegn")
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Ugyldig e-post"));

/** Gyldig Canvas base URL for StudyWise sin Canvas-integrasjon. */
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

  return KJENTE_CANVAS_HOSTS.has(hostname);
}

export const StoredCanvasBaseUrlSchema = z
  .string()
  .trim()
  .check(z.url({ message: "Ugyldig Canvas-URL" }))
  .refine((url) => CANVAS_BASE_URL_REGEX.test(url), {
    message: "Canvas-URL må være en komplett https://-adresse uten sti eller query",
  })
  .transform(normalizeCanvasBaseUrl);

export const CanvasBaseUrlSchema = StoredCanvasBaseUrlSchema
  .refine((url) => isAllowedCanvasBaseUrl(url), {
    message: "Må være en kjent Canvas-instans (f.eks. https://mitt.uib.no eller https://usn.instructure.com)",
  });

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

/** Innloggingsmetode (OAuth-leverandør eller e-post/passord). */
export const AUTH_PROVIDERS = ["google", "microsoft", "email"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
export const AuthProviderSchema = z.enum(AUTH_PROVIDERS);

/** OAuth-leverandører som bruker ekstern kontotilknytning (ikke e-post). */
export const OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OAuthProviderSchema = z.enum(OAUTH_PROVIDERS);

/** OAuth-konto tilknyttet en bruker (lagrer provider + providerAccountId for unikhet, og e-post for kryssvalidering). */
export const OAuthAccountSchema = z.object({
  provider: OAuthProviderSchema,
  providerAccountId: z.string().min(1, "OAuth provider account ID er påkrevd"),
  /** E-postadressen knyttet til OAuth-kontoen (brukes for kryssvalidering mot primær-e-post). */
  email: z.string().email().optional(),
});
export type OAuthAccount = z.infer<typeof OAuthAccountSchema>;

/** Typer Clerk↔lokal synkroniseringskonflikt som må vises til bruker. */
export const SYNC_CONFLICT_TYPES = ["email_mismatch", "oauth_link_rejected"] as const;
export type SyncConflictType = (typeof SYNC_CONFLICT_TYPES)[number];

export const SyncConflictSchema = z.object({
  type: z.enum(SYNC_CONFLICT_TYPES),
  melding: z.string(),
  clerkVerdi: z.string().optional(),
  lokalVerdi: z.string().optional(),
  oppdagetVed: z.string().datetime(),
});
export type SyncConflict = z.infer<typeof SyncConflictSchema>;

/** RBAC: kun vanlig bruker og admin. */
export const APP_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof APP_ROLES)[number];
export const RoleSchema = z.enum(APP_ROLES);
export const DEFAULT_ROLE: UserRole = "user";

/** Maks antall varsel-IDs per liste (lestIds / toastVistIds) – brukes i schema, frontend og backend. */
export const VARSLER_MAX_IDS = 500;

export const VarslerStateSchema = z.object({
  lestIds: z.array(z.string()).max(VARSLER_MAX_IDS, `Maks ${VARSLER_MAX_IDS} varsel-IDs`),
  toastVistIds: z.array(z.string()).max(VARSLER_MAX_IDS, `Maks ${VARSLER_MAX_IDS} varsel-IDs`),
});

/** Maks antall manuelt markerte Canvas-oppgaver per bruker. */
export const MANUELL_INNLEVERING_MAX_IDS = 2000;

export const ManuellInnleveringStateSchema = z.object({
  ferdigeIds: z
    .array(z.number().int().positive())
    .max(
      MANUELL_INNLEVERING_MAX_IDS,
      `Maks ${MANUELL_INNLEVERING_MAX_IDS} manuelt markerte oppgaver`,
    ),
});

/** UI-preferanser som synkes til backend slik at bruker slipper å sette dem på nytt. */
export const LANGUAGES = ["nb", "en"] as const;
export type AppLanguage = (typeof LANGUAGES)[number];

export const THEMES = ["light", "dark", "system"] as const;
export type AppTheme = (typeof THEMES)[number];

export const COOKIE_CONSENT_VALUES = ["accepted", "declined"] as const;
export type CookieConsentValue = (typeof COOKIE_CONSENT_VALUES)[number];

export const UIPreferencesSchema = z.object({
  language: z.enum(LANGUAGES).optional(),
  theme: z.enum(THEMES).optional(),
  cookieConsent: z.enum(COOKIE_CONSENT_VALUES).optional(),
});
export type UIPreferences = z.infer<typeof UIPreferencesSchema>;

export type CanvasContextPreferences = z.infer<typeof CanvasContextPreferencesSchema>;
export type VarslerState = z.infer<typeof VarslerStateSchema>;
export type ManuellInnleveringState = z.infer<typeof ManuellInnleveringStateSchema>;

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

export function createDefaultManuellInnleveringState(): ManuellInnleveringState {
  return {
    ferdigeIds: [],
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

export function normalizeManuellInnleveringState(
  manuellInnleveringState?: {
    ferdigeIds?: readonly number[];
  } | null,
): ManuellInnleveringState {
  const ferdigeIds = manuellInnleveringState?.ferdigeIds ?? [];

  return ManuellInnleveringStateSchema.parse({
    ferdigeIds: Array.from(new Set(ferdigeIds)).slice(-MANUELL_INNLEVERING_MAX_IDS),
  });
}

/** Maks antall skjulte emner per bruker. */
export const HIDDEN_COURSES_MAX = 200;

export const HiddenCourseIdsSchema = z.object({
  courseIds: z.array(z.number().int()).max(HIDDEN_COURSES_MAX),
});
export type HiddenCourseIds = z.infer<typeof HiddenCourseIdsSchema>;

export function normalizeHiddenCourseIds(
  hiddenCourseIds?: { courseIds?: readonly number[] } | null,
): HiddenCourseIds {
  const ids = hiddenCourseIds?.courseIds ?? [];
  return HiddenCourseIdsSchema.parse({
    courseIds: Array.from(new Set(ids)).slice(-HIDDEN_COURSES_MAX),
  });
}

export const PreferencesUpdateSchema = z
  .object({
    canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
    varslerState: VarslerStateSchema.optional(),
    manuellInnleveringState: ManuellInnleveringStateSchema.optional(),
    browserPushPreferences: BrowserPushPreferencesSchema.optional(),
    uiPreferences: UIPreferencesSchema.optional(),
    hiddenCourseIds: HiddenCourseIdsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const hasUiPreferences =
      data.uiPreferences !== undefined &&
      Object.values(data.uiPreferences).some((value) => value !== undefined);

    if (data.uiPreferences !== undefined && !hasUiPreferences) {
      ctx.addIssue({
        code: "custom",
        path: ["uiPreferences"],
        message: "Minst én UI-preferanse må oppgis",
      });
    }

    if (
      data.canvasContextPreferences === undefined &&
      data.varslerState === undefined &&
      data.manuellInnleveringState === undefined &&
      data.browserPushPreferences === undefined &&
      data.hiddenCourseIds === undefined &&
      !hasUiPreferences
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Ingen preferanser oppgitt",
      });
    }
  });

/** Minimumslengde for for-/etternavn for å regnes som komplett (unngår enkle initialer fra OAuth). */
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 256;

/** Sjekker om fornavn er gyldig (ikke bare en initial). */
export function isValidFirstName(firstName: string | null | undefined): boolean {
  return typeof firstName === "string" && firstName.trim().length >= MIN_NAME_LENGTH;
}

/** Sjekker om etternavn er gyldig. */
export function isValidLastName(lastName: string | null | undefined): boolean {
  return typeof lastName === "string" && lastName.trim().length >= MIN_NAME_LENGTH;
}

/** Sjekker om brukerprofilen er ufullstendig (manglende eller for kort for-/etternavn). */
export function isProfileIncomplete(user: { firstName?: string; lastName?: string } | null | undefined): boolean {
  if (!user) return true;
  return !isValidFirstName(user.firstName) || !isValidLastName(user.lastName);
}

// Auth bruker (lokal)
export const AuthBrukerSchema = z.object({
  id: z.string(),
  email: EmailSchema,
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  hasCanvasToken: z.boolean(),
  /** Canvas base URL for brukerens institusjon (multi-tenant). */
  canvasBaseUrl: StoredCanvasBaseUrlSchema.optional().nullable(),
  canvasContextPreferences: CanvasContextPreferencesSchema.optional(),
  varslerState: VarslerStateSchema.optional(),
  manuellInnleveringState: ManuellInnleveringStateSchema.optional(),
  browserPushPreferences: BrowserPushPreferencesSchema.optional(),
  uiPreferences: UIPreferencesSchema.optional(),
  hiddenCourseIds: HiddenCourseIdsSchema.optional(),
  /** RBAC-rolle (user, admin). */
  role: RoleSchema.optional(),
  /** Innloggingsmetode (google, microsoft, email). */
  authProvider: AuthProviderSchema.optional(),
  /** Om brukeren har aktivert tofaktorautentisering (MFA/TOTP). */
  mfaEnabled: z.boolean().optional(),
  /** Aktive Clerk↔lokal synkroniseringskonflikter som bruker må se. */
  syncConflicts: z.array(SyncConflictSchema).optional(),
});

/** Navnefelt: tillater enten gyldig navn (≥ MIN_NAME_LENGTH etter trim) eller tom streng (unset). */
const NameFieldSchema = z
  .string()
  .trim()
  .max(MAX_NAME_LENGTH, `Navn kan maks være ${MAX_NAME_LENGTH} tegn`)
  .refine(
    (v) => v.length === 0 || v.length >= MIN_NAME_LENGTH,
    `Navn må være tomt eller minst ${MIN_NAME_LENGTH} tegn`,
  )
  .optional();

/** Oppdatering av brukerprofil (fornavn, etternavn). Minst ett felt må oppgis. */
export const ProfileUpdateSchema = z
  .object({
    firstName: NameFieldSchema,
    lastName: NameFieldSchema,
    /** Hopp over tilbakesynk til Clerk (brukes når endringen allerede kom fra Clerk). */
    skipClerkSync: z.boolean().optional(),
  })
  .refine(
    (data) => data.firstName !== undefined || data.lastName !== undefined,
    "Minst ett felt må oppgis",
  );
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/** Brukernavn-begrensninger. */
export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Validerer brukernavnformat (lengde og tillatte tegn). */
export function isValidUsernameFormat(username: string): boolean {
  if (!username || typeof username !== "string") return false;
  const trimmed = username.trim();
  return (
    trimmed.length >= USERNAME_MIN_LENGTH &&
    trimmed.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(trimmed)
  );
}

/** Oppdatering av brukerprofil med brukernavn. Minst ett felt må oppgis. */
export const ProfileUpdateWithUsernameSchema = z
  .object({
    firstName: NameFieldSchema,
    lastName: NameFieldSchema,
    username: z
      .string()
      .trim()
      .min(USERNAME_MIN_LENGTH, `Brukernavn må være minst ${USERNAME_MIN_LENGTH} tegn`)
      .max(USERNAME_MAX_LENGTH, `Brukernavn kan maks være ${USERNAME_MAX_LENGTH} tegn`)
      .regex(USERNAME_PATTERN, "Brukernavn kan kun inneholde bokstaver, tall og understrek")
      .optional(),
    /** Hopp over tilbakesynk til Clerk (brukes når endringen allerede kom fra Clerk). */
    skipClerkSync: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.firstName !== undefined || data.lastName !== undefined || data.username !== undefined,
    "Minst ett felt må oppgis",
  );
export type ProfileUpdateWithUsername = z.infer<typeof ProfileUpdateWithUsernameSchema>;

export const ProfileUpdateResponseSchema = z.object({
  melding: z.string(),
  user: AuthBrukerSchema,
});
export type ProfileUpdateResponse = z.infer<typeof ProfileUpdateResponseSchema>;

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
  manuellInnleveringState: ManuellInnleveringStateSchema.optional(),
  browserPushPreferences: BrowserPushPreferencesSchema.optional(),
  uiPreferences: UIPreferencesSchema.optional(),
  hiddenCourseIds: HiddenCourseIdsSchema.optional(),
});

export const AccountDeletionDeletedSchema = z.object({
  user: z.boolean(),
  chatHistory: z.number().int().min(0),
  sharedChat: z.number().int().min(0),
  taskBreakdown: z.number().int().min(0),
  contentEmbedding: z.number().int().min(0),
  canvasUser: z.number().int().min(0),
  arbeidsplan: z.number().int().min(0),
});

export const AccountDeletionResponseSchema = z.object({
  melding: z.string(),
  deleted: AccountDeletionDeletedSchema,
  providerAccountDeleted: z.boolean(),
  vectorCleanupSucceeded: z.boolean(),
});

/** Kortlivet cookie som markerer at bruker nylig har passert auth-Turnstile. */
export const AUTH_TURNSTILE_COOKIE_NAME = "studywise_auth_turnstile";
export const AUTH_TURNSTILE_ACTION = "studywise-auth";
export const AUTH_TURNSTILE_COOKIE_VERSION = "v1";

/**
 * Validerer en rå Turnstile-cookie-verdi mot en HMAC-signatur.
 * Felles implementasjon som brukes av både frontend (SSR) og backend
 * for å unngå duplisert sikkerhetskritisk logikk.
 *
 * Bruker dynamisk import av crypto for å unngå top-level import
 * som kan feile i edge-runtimes.
 */
/**
 * Validerer en rå Turnstile-cookie-verdi mot en HMAC-signatur.
 * Format: v1.<nonce>.<expiresAt>.<signature>
 * HMAC dekker versjon, nonce og utløpstid for å binde cookien til en unik challenge.
 * Returnerer { valid, nonce } slik at backend kan håndheve server-side single-use via Redis.
 */
export async function validateAuthTurnstileCookieValue(
  rawValue: string | undefined,
  secret: string,
): Promise<boolean> {
  const result = await parseAuthTurnstileCookie(rawValue, secret);
  return result.valid;
}

export async function parseAuthTurnstileCookie(
  rawValue: string | undefined,
  secret: string,
): Promise<{ valid: boolean; nonce: string | null }> {
  if (!rawValue || !secret) return { valid: false, nonce: null };

  const parts = rawValue.split(".");
  if (parts.length !== 4) return { valid: false, nonce: null };

  const [version, nonce, expiresAt, signature] = parts;
  if (version !== AUTH_TURNSTILE_COOKIE_VERSION || !nonce || !expiresAt || !signature) {
    return { valid: false, nonce: null };
  }

  if (!/^[a-f0-9]{32}$/i.test(nonce) || !/^\d+$/.test(expiresAt) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { valid: false, nonce: null };
  }

  const crypto = await import("node:crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${AUTH_TURNSTILE_COOKIE_VERSION}:${nonce}:${expiresAt}`)
    .digest("hex");

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );

  if (!isValid || Number(expiresAt) <= Date.now()) {
    return { valid: false, nonce: null };
  }

  return { valid: true, nonce };
}

export const AuthTurnstileVerifyRequestSchema = z.object({
  turnstileToken: z
    .string()
    .trim()
    .min(1, "Turnstile-token mangler")
    .max(2048, "Turnstile-token er ugyldig"),
});

export const AuthTurnstileVerifyResponseSchema = z.object({
  success: z.literal(true),
});

/** BroadcastChannel for auth-sync på tvers av faner (Clerk session). */
export const AUTH_CHANNEL_NAME = "studywise_auth_sync";

// CSRF: frontend sender denne headeren på POST/PUT/PATCH/DELETE; backend krever den for å avvise forespørsler fra tredjepartsider.
export const AUTH_CSRF_HEADER_NAME = "x-studywise-csrf";
export const AUTH_CSRF_HEADER_VALUE = "1";

export const UsernameCheckQuerySchema = z.object({
  username: z
    .string()
    .trim()
    .min(USERNAME_MIN_LENGTH, `Brukernavn må være minst ${USERNAME_MIN_LENGTH} tegn`)
    .max(USERNAME_MAX_LENGTH, `Brukernavn kan maks være ${USERNAME_MAX_LENGTH} tegn`)
    .regex(USERNAME_PATTERN, "Brukernavn kan kun inneholde bokstaver, tall og understrek"),
});

export const UsernameCheckResponseSchema = z.object({
  available: z.boolean(),
  username: z.string(),
});

// TypeScript typer eksportering
export type CanvasTokenRequest = z.infer<typeof CanvasTokenRequestSchema>;
export type CanvasTokenResponse = z.infer<typeof CanvasTokenResponseSchema>;
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;
export type AuthBruker = z.infer<typeof AuthBrukerSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;
export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponseSchema>;
export type AuthTurnstileVerifyRequest = z.infer<typeof AuthTurnstileVerifyRequestSchema>;
export type AuthTurnstileVerifyResponse = z.infer<typeof AuthTurnstileVerifyResponseSchema>;
export type UsernameCheckQuery = z.infer<typeof UsernameCheckQuerySchema>;
export type UsernameCheckResponse = z.infer<typeof UsernameCheckResponseSchema>;

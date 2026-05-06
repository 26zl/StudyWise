/*
* Zod typer og skjemaer for Varsler og push-notifikasjoner
*/


import { z } from "zod";

export const BROWSER_PUSH_SENT_IDS_MAX = 500;

export const BrowserPushPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  announcements: z.boolean().default(true),
  deadlines: z.boolean().default(true),
  earlyDeadlines: z.boolean().default(true),
  events: z.boolean().default(true),
  aiResponses: z.boolean().default(true),
});

export type BrowserPushPreferences = z.infer<typeof BrowserPushPreferencesSchema>;

export const BrowserPushSentStateSchema = z.object({
  sentIds: z
    .array(z.string())
    .max(BROWSER_PUSH_SENT_IDS_MAX, `Maks ${BROWSER_PUSH_SENT_IDS_MAX} push-IDer`),
});

export type BrowserPushSentState = z.infer<typeof BrowserPushSentStateSchema>;

export const DEFAULT_BROWSER_PUSH_PREFERENCES: BrowserPushPreferences = {
  enabled: false,
  announcements: true,
  deadlines: true,
  earlyDeadlines: true,
  events: true,
  aiResponses: true,
};

export function createDefaultBrowserPushPreferences(): BrowserPushPreferences {
  return { ...DEFAULT_BROWSER_PUSH_PREFERENCES };
}

export function normalizeBrowserPushPreferences(
  preferences?: Partial<BrowserPushPreferences> | null,
): BrowserPushPreferences {
  return BrowserPushPreferencesSchema.parse({
    ...DEFAULT_BROWSER_PUSH_PREFERENCES,
    ...(preferences ?? {}),
  });
}

export function createDefaultBrowserPushSentState(): BrowserPushSentState {
  return { sentIds: [] };
}

export function normalizeBrowserPushSentState(
  state?: { sentIds?: readonly string[] } | null,
): BrowserPushSentState {
  const sentIds = state?.sentIds ?? [];
  return BrowserPushSentStateSchema.parse({
    sentIds: Array.from(new Set(sentIds)).slice(-BROWSER_PUSH_SENT_IDS_MAX),
  });
}

export const WebPushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1, "p256dh mangler"),
  auth: z.string().min(1, "auth mangler"),
});

// Gyldige push-tjeneste-domener (FCM, Mozilla, Apple, Windows)
const ALLOWED_PUSH_ENDPOINT_PATTERNS = [
  /^https:\/\/[a-z0-9.-]*\.google\.com\//,
  /^https:\/\/fcm\.googleapis\.com\//,
  /^https:\/\/[a-z0-9.-]*\.push\.services\.mozilla\.com\//,
  /^https:\/\/[a-z0-9.-]*\.push\.apple\.com\//,
  /^https:\/\/[a-z0-9.-]*\.notify\.windows\.com\//,
  /^https:\/\/push\.services\.mozilla\.com\//,
];

const WebPushEndpointSchema = z.url("Ugyldig endpoint")
  .max(2000, "Endpoint for lang")
  .refine((v) => v.startsWith("https://"), "Endpoint må bruke HTTPS")
  .refine(
    (v) => ALLOWED_PUSH_ENDPOINT_PATTERNS.some((p) => p.test(v)),
    "Endpoint må tilhøre en kjent push-tjeneste (FCM, Mozilla, Apple, Windows)",
  );

export const WebPushSubscriptionSchema = z.object({
  endpoint: WebPushEndpointSchema,
  expirationTime: z.number().int().nullable().optional(),
  keys: WebPushSubscriptionKeysSchema,
});

export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

export const SaveWebPushSubscriptionRequestSchema = z.object({
  subscription: WebPushSubscriptionSchema,
});

export const DeleteWebPushSubscriptionRequestSchema = z.object({
  endpoint: WebPushEndpointSchema,
});

export const WebPushSubscriptionResponseSchema = z.object({
  success: z.literal(true),
  subscribed: z.boolean(),
});

export const WebPushClientConfigResponseSchema = z.object({
  configured: z.boolean(),
  publicKey: z.string().min(1),
});

export const SendTestWebPushResponseSchema = z.object({
  success: z.literal(true),
  delivered: z.boolean(),
});

export type SaveWebPushSubscriptionRequest = z.infer<
  typeof SaveWebPushSubscriptionRequestSchema
>;
export type DeleteWebPushSubscriptionRequest = z.infer<
  typeof DeleteWebPushSubscriptionRequestSchema
>;
export type WebPushSubscriptionResponse = z.infer<
  typeof WebPushSubscriptionResponseSchema
>;
export type WebPushClientConfigResponse = z.infer<
  typeof WebPushClientConfigResponseSchema
>;
export type SendTestWebPushResponse = z.infer<
  typeof SendTestWebPushResponseSchema
>;

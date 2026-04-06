/**
 * MongoDB modell: `User`.
 *
 * Lokal StudyWise-bruker som speiler Clerk-identitet, lagrer RBAC-rolle, Canvas-token (kryptert)
 * og preferanser som synkes med frontend.
 */
import mongoose, { Schema, Document } from "mongoose";
import {
    normalizeCanvasBaseUrl,
    type UserRole,
    type AuthProvider,
    type OAuthAccount,
    type SyncConflict,
    APP_ROLES,
    AUTH_PROVIDERS,
    OAUTH_PROVIDERS,
    SYNC_CONFLICT_TYPES,
    createDefaultCanvasContextPreferences,
    createDefaultManuellInnleveringState,
    createDefaultVarslerState,
} from "common/auth";
import {
    createDefaultBrowserPushPreferences,
    createDefaultBrowserPushSentState,
    normalizeBrowserPushPreferences,
    type BrowserPushPreferences,
    type BrowserPushSentState,
} from "common/notifications";
import { SHA256_HEX_REGEX } from "../../utils/cryptoUtils.js";

// Type for Canvas-kontekst preferanser
export interface ICanvasContextPreferences {
    announcements: boolean;
    courses: boolean;
    assignments: boolean;
    events: boolean;
}

export interface IVarslerState {
    lestIds: string[];
    toastVistIds: string[];
}

export interface IManuellInnleveringState {
    ferdigeIds: number[];
}

export interface SanitizedUsername {
    username: string;
    usernameNormalized: string;
}

export function sanitizeUsername(username: string | null | undefined): SanitizedUsername | null {
    if (typeof username !== "string") {
        return null;
    }

    const trimmed = username.trim();
    if (!trimmed) {
        return null;
    }

    return {
        username: trimmed,
        usernameNormalized: trimmed.toLowerCase(),
    };
}

export interface IUser extends Document {
    email: string;
    /** Clerk user id (f.eks. user_xxx) for brukere som logger inn via Clerk. */
    clerkId?: string;
    /** Sist lokal profil ble synkronisert fra Clerk. */
    clerkProfileSyncedAt?: Date;
    /** Soft-delete tombstone for å hindre re-oppretting via Clerk etter kontosletting. */
    deletedAt?: Date;
    /** RBAC-rolle. Standard user. */
    role: UserRole;
    /** Om brukeren har aktivert tofaktorautentisering (MFA/TOTP) i Clerk. */
    mfaEnabled?: boolean;
    /** Innloggingsmetoder brukeren har brukt (f.eks. ["microsoft", "google"]). Oppdateres ved sync fra Clerk. */
    authProviders?: AuthProvider[];
    /** OAuth-kontoer koblet til brukeren (provider + providerAccountId for unikhet). */
    oauthAccounts?: OAuthAccount[];
    /** Clerk-brukernavn (påkrevd ved registrering). */
    username?: string;
    /** Intern normalisert variant av username for case-insensitiv unikhet. */
    usernameNormalized?: string;
    firstName?: string;
    lastName?: string;
    canvasApiToken?: string; // Kryptert token
    canvasBaseUrl?: string; // Canvas-instans for brukerens institusjon (multi-tenant, f.eks. https://ntnu.instructure.com)
    canvasTokenHash?: string; // Hash av token for rask sammenligning
    canvasUser?: mongoose.Types.ObjectId;
    /** Notion API-token for eksport (kryptert) */
    notionApiKey?: string;
    /** Standard Notion-side for eksport (page ID) */
    notionDefaultPageId?: string;
    // Skjulte Canvas-emne-IDer
    hiddenCourseIds?: { courseIds: number[] };
    // Brukerpreferanser for AI Canvas-kontekst
    canvasContextPreferences?: ICanvasContextPreferences;
    varslerState?: IVarslerState;
    manuellInnleveringState?: IManuellInnleveringState;
    browserPushPreferences?: BrowserPushPreferences;
    browserPushSentState?: BrowserPushSentState;
    uiPreferences?: {
        language?: "nb" | "en";
        theme?: "light" | "dark" | "system";
        cookieConsent?: "accepted" | "declined";
        hasSeenOnboarding?: boolean;
    };
    /** Aktive Clerk↔lokal synkroniseringskonflikter som vises til bruker. */
    syncConflicts?: SyncConflict[];
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema: Schema = new Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        clerkId: {
            type: String,
            trim: true,
        },
        clerkProfileSyncedAt: {
            type: Date,
            default: undefined,
        },
        deletedAt: {
            type: Date,
            default: undefined,
        },
        role: {
            type: String,
            enum: APP_ROLES,
            default: "user",
        },
        mfaEnabled: {
            type: Boolean,
            default: false,
        },
        authProviders: {
            type: [{ type: String, enum: AUTH_PROVIDERS }],
            default: undefined,
        },
        oauthAccounts: {
            type: [{
                provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
                providerAccountId: { type: String, required: true, trim: true },
                email: { type: String, trim: true, lowercase: true },
            }],
            default: [],
        },
        username: {
            type: String,
            trim: true,
        },
        usernameNormalized: {
            type: String,
            trim: true,
            lowercase: true,
            select: false,
        },
        firstName: {
            type: String,
            trim: true,
        },
        lastName: {
            type: String,
            trim: true,
        },
        canvasApiToken: {
            type: String, // Lagres kryptert. Dette er nøkkelen til å hente data for denne brukeren.
            select: false, // Hentes ikke som standard (sikkerhet). Må eksplisitt bes om med .select('+canvasApiToken').
        },
        canvasBaseUrl: {
            type: String,
            trim: true,
            default: undefined,
            set: normalizeCanvasBaseUrl,
        },
        canvasTokenHash: {
            type: String,
            select: false,
            match: SHA256_HEX_REGEX,
        },
        canvasUser: {
            type: Schema.Types.ObjectId,
            ref: 'CanvasUser',
            required: false,
        },
        notionApiKey: {
            type: String, // Kryptert. Brukes for Notion-eksport.
            select: false, // Hentes ikke som standard (sikkerhet).
        },
        notionDefaultPageId: {
            type: String,
            trim: true,
            default: undefined,
        },
        hiddenCourseIds: {
            type: {
                courseIds: {
                    type: [Number],
                    default: [],
                    validate: {
                        validator: (v: number[]) => v.length <= 200,
                        message: "hiddenCourseIds cannot exceed 200 items",
                    },
                },
            },
            default: undefined,
        },
        canvasContextPreferences: {
            type: {
                announcements: { type: Boolean, default: true },
                courses: { type: Boolean, default: true },
                assignments: { type: Boolean, default: true },
                events: { type: Boolean, default: true },
            },
            default: createDefaultCanvasContextPreferences,
        },
        varslerState: {
            type: {
                lestIds: {
                    type: [String],
                    default: [],
                    validate: {
                        validator: (v: string[]) => v.length <= 500,
                        message: "lestIds array cannot exceed 500 items",
                    },
                },
                toastVistIds: {
                    type: [String],
                    default: [],
                    validate: {
                        validator: (v: string[]) => v.length <= 500,
                        message: "toastVistIds array cannot exceed 500 items",
                    },
                },
            },
            default: createDefaultVarslerState,
        },
        manuellInnleveringState: {
            type: {
                ferdigeIds: {
                    type: [Number],
                    default: [],
                    validate: {
                        validator: (v: number[]) => v.length <= 2000,
                        message: "ferdigeIds array cannot exceed 2000 items",
                    },
                },
            },
            default: createDefaultManuellInnleveringState,
        },
        browserPushPreferences: {
            type: {
                enabled: { type: Boolean, default: false },
                announcements: { type: Boolean, default: true },
                deadlines: { type: Boolean, default: true },
                earlyDeadlines: { type: Boolean, default: true },
                events: { type: Boolean, default: true },
                aiResponses: { type: Boolean, default: true },
            },
            default: createDefaultBrowserPushPreferences,
            set: normalizeBrowserPushPreferences,
        },
        browserPushSentState: {
            type: {
                sentIds: {
                    type: [String],
                    default: [],
                    validate: {
                        validator: (v: string[]) => v.length <= 500,
                        message: "sentIds array cannot exceed 500 items",
                    },
                },
            },
            default: createDefaultBrowserPushSentState,
        },
        uiPreferences: {
            type: {
                language: { type: String, enum: ["nb", "en"] },
                theme: { type: String, enum: ["light", "dark", "system"] },
                cookieConsent: { type: String, enum: ["accepted", "declined"] },
                hasSeenOnboarding: { type: Boolean },
            },
            default: undefined,
        },
        syncConflicts: {
            type: [{
                type: { type: String, enum: SYNC_CONFLICT_TYPES, required: true },
                melding: { type: String, required: true },
                clerkVerdi: { type: String },
                lokalVerdi: { type: String },
                oppdagetVed: { type: String, required: true },
            }],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// Clerk-brukere slås opp på clerkId
UserSchema.index({ clerkId: 1 }, { unique: true, sparse: true, name: "clerk_id_unique" });
UserSchema.index(
    { usernameNormalized: 1 },
    { unique: true, sparse: true, name: "username_normalized_unique" },
);

// Samme OAuth-konto (provider + providerAccountId) kan ikke være koblet til flere brukere.
// Dette forhindrer at samme Google/Microsoft-konto brukes på flere StudyWise-kontoer.
UserSchema.index(
    { "oauthAccounts.provider": 1, "oauthAccounts.providerAccountId": 1 },
    {
        unique: true,
        sparse: true,
        name: "oauth_accounts_provider_account_id_unique",
    },
);

// OAuth-e-post brukes for kryssvalidering (forhindre registrering med e-post som allerede er linket via OAuth).
UserSchema.index(
    { "oauthAccounts.email": 1 },
    { sparse: true, name: "oauth_accounts_email" },
);

// Merk: email har allerede indeks via unique: true.
// Canvas-token må være tenant-aware, så vi bruker sammensatt indeks.
UserSchema.index(
    { canvasBaseUrl: 1, canvasTokenHash: 1 },
    {
        unique: true,
        sparse: true,
        name: "canvas_base_url_canvas_token_hash_unique",
    }
);
UserSchema.index(
    { canvasUser: 1 },
    {
        unique: true,
        sparse: true,
        name: "canvas_user_unique",
    },
);

// Compound index for queries som filtrerer på email + deletedAt (f.eks. i findOrCreateUserByClerkId)
UserSchema.index(
    { email: 1, deletedAt: 1 },
    { name: "email_deleted_at" },
);

export const User = mongoose.model<IUser>('User', UserSchema);

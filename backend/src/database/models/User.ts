import mongoose, { Schema, Document } from 'mongoose';
import {
    normalizeCanvasBaseUrl,
    type UserRole,
    type AuthProvider,
    APP_ROLES,
    AUTH_PROVIDERS,
    createDefaultCanvasContextPreferences,
    createDefaultVarslerState,
} from "common/auth";

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

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
    /** Innloggingsmetode (google, microsoft, email). Settes ved opprettelse/sync fra Clerk. */
    authProvider?: AuthProvider;
    /** Clerk-brukernavn (påkrevd ved registrering). */
    username?: string;
    firstName?: string;
    lastName?: string;
    canvasApiToken?: string; // Kryptert token
    canvasBaseUrl?: string; // Canvas-instans for brukerens institusjon (multi-tenant, f.eks. https://ntnu.instructure.com)
    canvasTokenHash?: string; // Hash av token for rask sammenligning
    canvasUser?: mongoose.Types.ObjectId;
    // Brukerpreferanser for AI Canvas-kontekst
    canvasContextPreferences?: ICanvasContextPreferences;
    varslerState?: IVarslerState;
    uiPreferences?: {
        language?: "nb" | "en";
        theme?: "light" | "dark" | "system";
        cookieConsent?: "accepted" | "declined";
    };
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
        authProvider: {
            type: String,
            enum: AUTH_PROVIDERS,
            default: undefined,
        },
        username: {
            type: String,
            trim: true,
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
                lestIds: { type: [String], default: [] },
                toastVistIds: { type: [String], default: [] },
            },
            default: createDefaultVarslerState,
        },
        uiPreferences: {
            type: {
                language: { type: String, enum: ["nb", "en"] },
                theme: { type: String, enum: ["light", "dark", "system"] },
                cookieConsent: { type: String, enum: ["accepted", "declined"] },
            },
            default: undefined,
        },
    },
    {
        timestamps: true,
    }
);

// Clerk-brukere slås opp på clerkId
UserSchema.index({ clerkId: 1 }, { unique: true, sparse: true, name: "clerk_id_unique" });

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

export const User = mongoose.model<IUser>('User', UserSchema);

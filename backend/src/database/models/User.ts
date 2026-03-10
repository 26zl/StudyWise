import mongoose, { Schema, Document } from 'mongoose';
import { normalizeCanvasBaseUrl } from "common/auth";

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
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    canvasApiToken?: string; // Kryptert token
    canvasBaseUrl?: string; // Canvas-instans for brukerens institusjon (multi-tenant, f.eks. https://ntnu.instructure.com)
    canvasTokenHash?: string; // Hash av token for rask sammenligning
    canvasUser?: mongoose.Types.ObjectId;
    refreshTokenHash?: string;
    refreshTokenExpiresAt?: Date;
    // Brukerpreferanser for AI Canvas-kontekst
    canvasContextPreferences?: ICanvasContextPreferences;
    varslerState?: IVarslerState;
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
        passwordHash: {
            type: String,
            required: true,
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
        refreshTokenHash: {
            type: String,
            select: false,
            match: SHA256_HEX_REGEX,
        },
        refreshTokenExpiresAt: {
            type: Date,
        },
        canvasContextPreferences: {
            type: {
                announcements: { type: Boolean, default: true },
                courses: { type: Boolean, default: true },
                assignments: { type: Boolean, default: true },
                events: { type: Boolean, default: true },
            },
            default: {
                announcements: true,
                courses: true,
                assignments: true,
                events: true,
            },
        },
        varslerState: {
            type: {
                lestIds: { type: [String], default: [] },
                toastVistIds: { type: [String], default: [] },
            },
            default: {
                lestIds: [],
                toastVistIds: [],
            },
        },
    },
    {
        timestamps: true,
    }
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

export const User = mongoose.model<IUser>('User', UserSchema);

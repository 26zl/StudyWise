/**
 * MongoDB modell: `CanvasUser`.
 *
 * Cache av Canvas-profilinfo (Canvas-bruker) koblet til lokal `User` via `localUser`.
 * Brukes for å unngå hyppige Canvas API-kall og for å vise profilkontekst i UI.
 */
import mongoose, { Schema, Document } from "mongoose";
import { normalizeCanvasBaseUrl } from "common/auth";

export interface ICanvasUser extends Document {
    canvasId: number;
    canvasBaseUrl: string;
    name: string;
    sortableName?: string;
    shortName?: string;
    avatarUrl?: string;
    firstName?: string;
    lastName?: string;
    locale?: string;
    effectiveLocale?: string;
    permissions?: {
        canUpdateName: boolean;
        canUpdateAvatar: boolean;
        limitParentAppWebAccess: boolean;
    };
    canvasUserCreatedAt: Date;
    localUser: mongoose.Types.ObjectId; // Referanse til vår egen User model
}

const CanvasUserSchema: Schema = new Schema(
    {
        canvasId: {
            type: Number,
            required: true,
        },
        canvasBaseUrl: {
            type: String,
            required: true,
            trim: true,
            set: normalizeCanvasBaseUrl,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        sortableName: {
            type: String,
            trim: true,
        },
        shortName: {
            type: String,
            trim: true,
        },
        avatarUrl: {
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
        locale: {
            type: String,
            default: null,
        },
        effectiveLocale: {
            type: String,
            trim: true,
        },
        permissions: {
            canUpdateName: { type: Boolean, default: false },
            canUpdateAvatar: { type: Boolean, default: false },
            limitParentAppWebAccess: { type: Boolean, default: false },
        },
        canvasUserCreatedAt: {
            type: Date,
        },
        localUser: {
            type: Schema.Types.ObjectId,
            ref: 'User', // Dette er koblingen tilbake til Login-brukeren (User model).
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

CanvasUserSchema.index(
    { canvasBaseUrl: 1, canvasId: 1 },
    { unique: true, name: "canvas_base_url_canvas_id_unique" },
);
CanvasUserSchema.index(
    { localUser: 1 },
    { unique: true, name: "canvas_user_local_user_unique" },
);

export const CanvasUser = mongoose.model<ICanvasUser>('CanvasUser', CanvasUserSchema);

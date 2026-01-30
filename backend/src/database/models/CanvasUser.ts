import mongoose, { Schema, Document } from 'mongoose';

export interface ICanvasUser extends Document {
    canvasId: number;
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
            unique: true,
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

export const CanvasUser = mongoose.model<ICanvasUser>('CanvasUser', CanvasUserSchema);

import mongoose, { Schema, Document } from 'mongoose';

// Type for Canvas-kontekst preferanser
export interface ICanvasContextPreferences {
    announcements: boolean;
    courses: boolean;
    assignments: boolean;
    events: boolean;
}

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    canvasApiToken?: string; // Kryptert token
    canvasTokenHash?: string; // Hash av token for rask sammenligning
    canvasUser?: mongoose.Types.ObjectId;
    refreshTokenHash?: string;
    refreshTokenExpiresAt?: Date;
    // Brukerpreferanser for AI Canvas-kontekst
    canvasContextPreferences?: ICanvasContextPreferences;
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
        canvasTokenHash: {
            type: String,
            select: false,
            unique: true, // Kan kun tilhøre én bruker
            sparse: true, // Tillater flere brukere UTEN token (null/undefined)
        },
        canvasUser: {
            type: Schema.Types.ObjectId,
            ref: 'CanvasUser',
            required: false,
        },
        refreshTokenHash: {
            type: String,
            select: false,
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
    },
    {
        timestamps: true,
    }
);

// Merk: email og canvasTokenHash har allerede indekser via unique: true
// Ikke legg til manuelle indekser for disse - det skaper duplikater

export const User = mongoose.model<IUser>('User', UserSchema);

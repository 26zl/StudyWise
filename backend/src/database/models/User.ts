import mongoose, { Schema, Document } from 'mongoose';

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
    },
    {
        timestamps: true,
    }
);

export const User = mongoose.model<IUser>('User', UserSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    canvasApiToken?: string; // Kryptert token
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
            type: String, // Lagres kryptert. VIKTIG: Dette er nøkkelen til å hente data for denne brukeren.
            select: false, // Hentes ikke som standard (sikkerhet). Må eksplisitt bes om med .select('+canvasApiToken').
        },
    },
    {
        timestamps: true,
    }
);

export const User = mongoose.model<IUser>('User', UserSchema);

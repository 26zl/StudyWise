/**
 * MongoDB modell: `DeletedUserTombstone`.
 *
 * Minimal tombstone for slettede brukere. Brukes kun til å:
 * 1. Frigjøre OAuth-kontoer/brukernavn ved nye registreringer
 * 2. Hindre umiddelbar gjenoppretting via Clerk webhook
 *
 * Alle andre brukerdata hard-slettes fra `users`-samlingen.
 * Tombstones har 90-dagers TTL og slettes automatisk av MongoDB.
 */
import mongoose, { Schema, Document } from "mongoose";
import { OAUTH_PROVIDERS, type OAuthAccount } from "common/auth";

export interface IDeletedUserTombstone extends Document {
  /** Original MongoDB User._id (for audit/referanse). */
  originalUserId: mongoose.Types.ObjectId;
  /** Clerk user id (for å blokkere reaktivering før Clerk-sletting er bekreftet). */
  clerkId?: string;
  /** OAuth-kontoer som kan frigjøres for nye brukere. */
  oauthAccounts?: OAuthAccount[];
  /** Normalisert brukernavn som kan frigjøres for nye brukere. */
  usernameNormalized?: string;
  /** Tidspunkt for sletting. */
  deletedAt: Date;
}

const TOMBSTONE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 dager

const DeletedUserTombstoneSchema: Schema = new Schema(
  {
    originalUserId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    clerkId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    oauthAccounts: {
      type: [
        {
          provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
          providerAccountId: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },
    usernameNormalized: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      index: true,
    },
    deletedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: { expireAfterSeconds: TOMBSTONE_TTL_SECONDS },
    },
  },
  {
    timestamps: false,
    collection: "deleteduserTombstones",
  },
);

// Compound index for OAuth-lookup — unique for å forhindre dupliserte tombstones for samme OAuth-konto
DeletedUserTombstoneSchema.index(
  { "oauthAccounts.provider": 1, "oauthAccounts.providerAccountId": 1 },
  { sparse: true, unique: true },
);

export const DeletedUserTombstone = mongoose.model<IDeletedUserTombstone>(
  "DeletedUserTombstone",
  DeletedUserTombstoneSchema,
);

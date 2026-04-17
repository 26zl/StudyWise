/**
 * MongoDB-modell: `SystemAnnouncement`.
 *
 * Globalt banner som admin kan publisere til alle innloggede brukere. Brukes
 * til å kommunisere utage, vedlikehold eller andre driftsbeskjeder.
 *
 * Modellen lagrer ÉN rad (singleton) med en fast `singletonKey: "global"`.
 * Det gjør det trivielt å hente gjeldende melding uten å måtte finne siste
 * versjon — en enkelt `findOne({ singletonKey: "global" })`.
 */

import { Schema, model } from "mongoose";

export interface SystemAnnouncementDocument {
  /** Alltid "global" — brukes for å sikre at vi bare har én banner-rad totalt. */
  singletonKey: "global";
  /** Om banneret skal vises til brukere. */
  active: boolean;
  severity: "info" | "warning" | "critical";
  melding: string;
  /** Om brukeren kan lukke banneret. */
  dismissible: boolean;
  /** Hvem publiserte — audit-formål. */
  publishedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SystemAnnouncementSchema = new Schema<SystemAnnouncementDocument>(
  {
    singletonKey: {
      type: String,
      enum: ["global"],
      required: true,
      unique: true,
      default: "global",
    },
    active: { type: Boolean, required: true, default: false },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      required: true,
      default: "info",
    },
    melding: { type: String, required: true, default: "", maxlength: 500 },
    dismissible: { type: Boolean, required: true, default: true },
    publishedBy: { type: String, default: undefined },
  },
  { timestamps: true },
);

export const SystemAnnouncement = model<SystemAnnouncementDocument>(
  "SystemAnnouncement",
  SystemAnnouncementSchema,
  "systemAnnouncements",
);

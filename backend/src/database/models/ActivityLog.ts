/**
 * MongoDB modell: `ActivityLog`.
 *
 * Sporer brukerens aktive tid utenfor rene chat-meldinger (dashboard, kalender,
 * canvas, bokmerker, quiz osv.) ved å motta heartbeats fra frontend. Hver rad
 * representerer ett sammenhengende intervall [start, end]. /study-stats/today
 * fletter disse intervallene sammen med chat-intervallene (fra ChatHistory) for
 * å beregne total studietid uten dobbelttelling.
 *
 * TTL: end + 30 dager. Kun dagens rader leses i studietid-beregningen, men vi
 * beholder 30 dager for framtidig uke-/månedsvisning.
 */
import { Schema, model, Types } from "mongoose";
import { ACTIVITY_TYPES, type ActivityType } from "common/activity";

export interface ActivityLogDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: ActivityType;
  start: Date;
  end: Date;
}

const ActivityLogSchema = new Schema<ActivityLogDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false },
);

// Primærspørring: dagens intervaller for én bruker, sortert etter slutt-tid.
// Vi filtrerer på `end >= todayStart` i /study-stats/today.
ActivityLogSchema.index({ user: 1, end: -1 });

// TTL-indeks på `end` — MongoDB sletter dokumentet 30 dager etter siste oppdatering av end.
ActivityLogSchema.index({ end: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const ActivityLog = model<ActivityLogDocument>("ActivityLog", ActivityLogSchema);

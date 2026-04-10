/*
 * Web-push utsending: job-type for den unified BullMQ-køen.
 *
 * Semantikk:
 *   - Maks 5 forsøk (push-varsler er tidssensitive — gi opp raskt)
 *   - Eksponentiell backoff: 30s → 1m → 2m → 4m → 8m
 *   - Job-ID: `push_${subscriptionId}_${candidateId}` for naturlig dedup
 *   - Failed jobs beholdes for inspeksjon (admin "Køer"-fanen)
 *
 * 404/410 fra push-tjenesten = subscription er død → slettes fra DB i jobben,
 * og jobben markeres som "completed" (ikke retry).
 */

import type { Job } from "bullmq";
import mongoose from "mongoose";
import * as webpush from "web-push";
import { getUnifiedQueue } from "./connection.js";
import { WebPushSubscriptionModel } from "../database/models/WebPushSubscription.js";
import { logger } from "../utils/logger.js";

export const WEB_PUSH_JOB_NAME = "web-push";
const MAX_ATTEMPTS = 5;

const webPushClient = (
  "default" in webpush &&
  webpush.default &&
  typeof webpush.default === "object"
    ? webpush.default
    : webpush
) as typeof webpush;

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:kontakt@studwize.page";
  if (!publicKey || !privateKey) return false;
  webPushClient.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export interface WebPushJobData {
  subscriptionId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
  };
}

const JOB_OPTIONS = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: false,
};

/**
 * Enqueue et web-push-varsel for én subscription. Job-ID kombinerer
 * subscriptionId + candidateId så samme varsel ikke sendes flere ganger.
 */
export async function enqueueWebPushDelivery(input: {
  subscriptionId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  candidateId: string;
  payload: WebPushJobData["payload"];
}): Promise<void> {
  const q = getUnifiedQueue();
  await q.add(
    WEB_PUSH_JOB_NAME,
    {
      subscriptionId: input.subscriptionId,
      endpoint: input.endpoint,
      expirationTime: input.expirationTime,
      keys: input.keys,
      payload: input.payload,
    },
    {
      ...JOB_OPTIONS,
      jobId: `push_${input.subscriptionId}_${input.candidateId}`,
    },
  );
}

function isGoneSubscriptionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : null;
  return statusCode === 404 || statusCode === 410;
}

export async function processWebPushJob(job: Job<WebPushJobData>): Promise<void> {
  if (!ensureVapidConfigured()) {
    throw new Error("VAPID-konfigurasjon mangler — kan ikke sende web-push");
  }

  const { subscriptionId, endpoint, expirationTime, keys, payload } = job.data;

  const pushSubscription: webpush.PushSubscription = {
    endpoint,
    expirationTime: expirationTime ?? null,
    keys,
  };

  try {
    await webPushClient.sendNotification(
      pushSubscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
      }),
    );
  } catch (error) {
    if (isGoneSubscriptionError(error)) {
      try {
        await WebPushSubscriptionModel.deleteOne({
          _id: new mongoose.Types.ObjectId(subscriptionId),
        });
        logger.info(
          { subscriptionId, endpoint },
          "Slettet ugyldig web-push-abonnement (410/404)",
        );
      } catch (delErr) {
        logger.warn(
          { err: delErr, subscriptionId },
          "Kunne ikke slette død web-push-subscription",
        );
      }
      return;
    }
    throw error;
  }
}

export function handleWebPushFailure(job: Job<WebPushJobData> | undefined, err: Error): void {
  if (!job) return;
  logger.warn(
    {
      err,
      subscriptionId: job.data.subscriptionId,
      attemptsMade: job.attemptsMade,
      maxAttempts: MAX_ATTEMPTS,
    },
    "Web-push-utsending feilet",
  );
}

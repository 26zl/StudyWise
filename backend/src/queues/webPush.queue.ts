/*
 * BullMQ-kø for utsending av web-push-varsler.
 *
 * Erstatter direkte `webpush.sendNotification()` i `webPush.service.ts`. Hvert
 * abonnement får sin egen jobb, så transient-feil mot Apple/Mozilla/Google sine
 * push-tjenester (5xx, timeouts) får automatisk retry uten å blokkere kalleren.
 *
 * Semantikk:
 *   - Maks 5 forsøk (push-varsler er tidssensitive — gi opp raskt)
 *   - Eksponentiell backoff: 30s → 1m → 2m → 4m → 8m
 *   - Job-ID: `${subscriptionId}:${candidateId}` for naturlig dedup
 *   - Failed jobs beholdes for inspeksjon (admin "Køer"-fanen)
 *
 * 404/410 fra push-tjenesten = subscription er død → slettes fra DB i jobben,
 * og jobben markeres som "completed" (ikke retry — det er ingen ting å rette).
 */

import { Queue, Worker, type Job } from "bullmq";
import mongoose from "mongoose";
import * as webpush from "web-push";
import { getSharedQueueConnection, createWorkerConnection } from "./connection.js";
import { WebPushSubscriptionModel } from "../database/models/WebPushSubscription.js";
import { logger } from "../utils/logger.js";

export const WEB_PUSH_QUEUE_NAME = "web-push";
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

let queue: Queue<WebPushJobData> | null = null;
let worker: Worker<WebPushJobData> | null = null;

export function getWebPushQueue(): Queue<WebPushJobData> {
  if (queue) return queue;
  queue = new Queue<WebPushJobData>(WEB_PUSH_QUEUE_NAME, {
    connection: getSharedQueueConnection(),
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: false,
    },
  });
  return queue;
}

/**
 * Enqueue et web-push-varsel for én subscription. Job-ID kombinerer
 * subscriptionId + candidateId så samme varsel ikke sendes flere ganger til
 * samme abonnement (BullMQ ignorer add med samme jobId).
 */
export async function enqueueWebPushDelivery(input: {
  subscriptionId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  candidateId: string;
  payload: WebPushJobData["payload"];
}): Promise<void> {
  const q = getWebPushQueue();
  await q.add(
    "deliver",
    {
      subscriptionId: input.subscriptionId,
      endpoint: input.endpoint,
      expirationTime: input.expirationTime,
      keys: input.keys,
      payload: input.payload,
    },
    {
      jobId: `${input.subscriptionId}:${input.candidateId}`,
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

async function processJob(job: Job<WebPushJobData>): Promise<void> {
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
      // Død subscription — slett fra DB og marker jobben som completed.
      // Det er ingenting å prøve igjen for denne.
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
    // Transient feil → kast videre så BullMQ retryer med backoff
    throw error;
  }
}

export function startWebPushWorker(): Worker<WebPushJobData> {
  if (worker) return worker;

  worker = new Worker<WebPushJobData>(WEB_PUSH_QUEUE_NAME, processJob, {
    connection: createWorkerConnection(WEB_PUSH_QUEUE_NAME),
    // Web-push er nettverks-bound og uavhengig per subscription — kjør flere parallelt
    concurrency: 10,
  });

  worker.on("failed", (job, err) => {
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
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Web-push worker feilet");
  });

  logger.info("Web-push worker startet");
  return worker;
}

export async function closeWebPushWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}

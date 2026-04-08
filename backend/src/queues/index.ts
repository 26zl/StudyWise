/*
 * BullMQ workers — sentralt registry for oppstart/avstenging.
 *
 * Importeres fra `index.ts` ved oppstart. Holder workers og queues i én fil
 * slik at graceful shutdown kan stenge dem alle uten å vite om de enkelte
 * implementasjonene.
 */

import {
  getClerkDeletionQueue,
  startClerkDeletionWorker,
  closeClerkDeletionWorker,
} from "./clerkDeletion.queue.js";
import {
  getPineconeCleanupQueue,
  startPineconeCleanupWorker,
  closePineconeCleanupWorker,
} from "./pineconeCleanup.queue.js";
import {
  getWebPushQueue,
  startWebPushWorker,
  closeWebPushWorker,
} from "./webPush.queue.js";
import { closeAllBullMqConnections } from "./connection.js";

const QUEUE_START_TIMEOUT_MS = 15000;

async function waitForQueueReady<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} ble ikke klar innen ${QUEUE_START_TIMEOUT_MS}ms`));
        }, QUEUE_START_TIMEOUT_MS);
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Starter alle workers. Idempotent: trygg å kalle flere ganger.
 */
export async function startQueueWorkers(): Promise<void> {
  try {
    const clerkQueue = getClerkDeletionQueue();
    const pineconeQueue = getPineconeCleanupQueue();
    const webPushQueue = getWebPushQueue();
    const clerkWorker = startClerkDeletionWorker();
    const pineconeWorker = startPineconeCleanupWorker();
    const webPushWorker = startWebPushWorker();

    await Promise.all([
      waitForQueueReady(clerkQueue.waitUntilReady(), "Clerk-kø"),
      waitForQueueReady(pineconeQueue.waitUntilReady(), "Pinecone-kø"),
      waitForQueueReady(webPushQueue.waitUntilReady(), "Web-push-kø"),
      waitForQueueReady(clerkWorker.waitUntilReady(), "Clerk-worker"),
      waitForQueueReady(pineconeWorker.waitUntilReady(), "Pinecone-worker"),
      waitForQueueReady(webPushWorker.waitUntilReady(), "Web-push-worker"),
    ]);
  } catch (error) {
    await stopQueueWorkers();
    throw error;
  }
}

export async function stopQueueWorkers(): Promise<void> {
  await closeClerkDeletionWorker();
  await closePineconeCleanupWorker();
  await closeWebPushWorker();
  await closeAllBullMqConnections();
}

/** Brukes av Bull Board for å vise alle køer. */
export function getAllQueues() {
  return [getClerkDeletionQueue(), getPineconeCleanupQueue(), getWebPushQueue()];
}

/** Slår opp en kø ved navn — returnerer null hvis ukjent navn. */
export function getQueueByName(name: string) {
  return getAllQueues().find((q) => q.name === name) ?? null;
}

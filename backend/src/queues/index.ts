/*
 * BullMQ unified worker — sentralt registry for oppstart/avstenging.
 *
 * Alle job-typer (clerk-deletion, pinecone-cleanup, web-push) prosesseres
 * av én Worker på én kø ("studywise-jobs"). Dette reduserer antall
 * Redis-tilkoblinger fra 8 til 4 per instans (1 cache + 1 kø + 2 worker).
 *
 * BullMQ dupliserer worker-tilkoblingen internt for blocking commands,
 * så én Worker = 2 TCP-connections. Tre separate workers = 6 connections.
 */

import { Queue, Worker, type Job } from "bullmq";
import {
  getUnifiedQueue,
  getSharedQueueConnection,
  getWorkerConnection,
  closeAllBullMqConnections,
  UNIFIED_QUEUE_NAME,
} from "./connection.js";
import {
  CLERK_DELETION_JOB_NAME,
  processClerkDeletionJob,
  handleClerkDeletionFailure,
} from "./clerkDeletion.queue.js";
import {
  PINECONE_CLEANUP_JOB_NAME,
  processPineconeCleanupJob,
  handlePineconeCleanupFailure,
} from "./pineconeCleanup.queue.js";
import {
  WEB_PUSH_JOB_NAME,
  processWebPushJob,
  handleWebPushFailure,
} from "./webPush.queue.js";
import { logger } from "../utils/logger.js";

const QUEUE_START_TIMEOUT_MS = 15000;

let worker: Worker | null = null;

async function waitForReady<T>(promise: Promise<T>, label: string): Promise<T> {
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
 * Dispatcher — ruter jobber til riktig prosessor basert på job.name.
 */
async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case CLERK_DELETION_JOB_NAME:
      return processClerkDeletionJob(job);
    case PINECONE_CLEANUP_JOB_NAME:
      return processPineconeCleanupJob(job);
    case WEB_PUSH_JOB_NAME:
      return processWebPushJob(job);
    default:
      logger.warn({ jobName: job.name, jobId: job.id }, "Ukjent job-type i unified kø");
  }
}

/**
 * Engangs-migrasjon: flytter ventende jobs fra de gamle separate køene
 * (clerk-deletion, pinecone-cleanup, web-push) til den nye unified køen.
 * Idempotent — trygt å kjøre flere ganger. Bruker den delte tilkoblingen
 * (ingen ekstra Redis-connections).
 */
async function migrateOldQueues(): Promise<void> {
  const OLD_QUEUES: { oldName: string; jobName: string; idPrefix: string }[] = [
    { oldName: "clerk-deletion", jobName: CLERK_DELETION_JOB_NAME, idPrefix: "clerk_" },
    { oldName: "pinecone-cleanup", jobName: PINECONE_CLEANUP_JOB_NAME, idPrefix: "pinecone_" },
    { oldName: "web-push", jobName: WEB_PUSH_JOB_NAME, idPrefix: "push_" },
  ];

  const unified = getUnifiedQueue();
  const conn = getSharedQueueConnection();
  let totalMigrated = 0;

  for (const { oldName, jobName, idPrefix } of OLD_QUEUES) {
    const oldQueue = new Queue(oldName, { connection: conn });
    try {
      const jobs = await oldQueue.getJobs(
        ["waiting", "delayed", "failed", "active"],
        0,
        500,
      );
      if (jobs.length === 0) continue;

      for (const job of jobs) {
        const newJobId = job.id ? `${idPrefix}${job.id}` : undefined;
        await unified.add(jobName, job.data, {
          attempts: job.opts.attempts,
          backoff: job.opts.backoff,
          removeOnComplete: job.opts.removeOnComplete,
          removeOnFail: job.opts.removeOnFail,
          jobId: newJobId,
        });
        await job.remove();
        totalMigrated++;
      }

      logger.info(
        { oldQueue: oldName, count: jobs.length },
        "Migrerte jobs fra gammel kø til unified kø",
      );
    } catch (err) {
      logger.warn(
        { err, oldQueue: oldName },
        "Kunne ikke migrere gammel kø (kan være tom/slettet)",
      );
    } finally {
      await oldQueue.close();
    }
  }

  if (totalMigrated > 0) {
    logger.info({ totalMigrated }, "Kø-migrasjon fullført");
  }
}

/**
 * Starter unified kø + worker. Idempotent: trygg å kalle flere ganger.
 */
export async function startQueueWorkers(): Promise<void> {
  try {
    const queue = getUnifiedQueue();
    await waitForReady(queue.waitUntilReady(), "Unified kø");

    // Flytt eventuelle jobs fra de gamle separate køene før workeren starter.
    await migrateOldQueues();

    if (!worker) {
      worker = new Worker(UNIFIED_QUEUE_NAME, processJob, {
        connection: getWorkerConnection(),
        // Web-push er den mest frekvente job-typen og er nettverks-bound,
        // så concurrency settes for den. Clerk/Pinecone-jobs er sjeldne
        // og påvirkes ikke negativt av å dele pool.
        concurrency: 10,
      });

      worker.on("failed", (job, err) => {
        if (!job) return;
        switch (job.name) {
          case CLERK_DELETION_JOB_NAME:
            handleClerkDeletionFailure(job, err);
            break;
          case PINECONE_CLEANUP_JOB_NAME:
            handlePineconeCleanupFailure(job, err);
            break;
          case WEB_PUSH_JOB_NAME:
            handleWebPushFailure(job, err);
            break;
          default:
            logger.warn({ err, jobName: job.name }, "Ukjent job feilet");
        }
      });

      worker.on("completed", (job) => {
        if (job) {
          logger.info({ jobName: job.name, jobId: job.id }, "Job fullført");
        }
      });

      worker.on("error", (err) => {
        logger.error({ err }, "Unified worker feilet");
      });
    }

    await waitForReady(worker.waitUntilReady(), "Unified worker");
  } catch (error) {
    await stopQueueWorkers();
    throw error;
  }
}

export async function stopQueueWorkers(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeAllBullMqConnections();
}

/**
 * Indikerer om unified worker er startet og klar. Brukes av helsestatus-
 * endepunktet for å skille "Redis oppe men BullMQ aldri startet" fra
 * "alt fungerer". worker er null hvis enten startQueueWorkers aldri kjørte
 * (f.eks. fordi Redis var nede ved oppstart) eller hvis stopQueueWorkers
 * ryddet opp.
 */
export function isWorkerRunning(): boolean {
  return worker !== null;
}

/** Brukes av admin-panelet for å vise kø-status. */
export function getAllQueues() {
  return [getUnifiedQueue()];
}

/** Slår opp køen ved navn — returnerer null hvis ukjent. */
export function getQueueByName(name: string) {
  const queue = getUnifiedQueue();
  return queue.name === name ? queue : null;
}

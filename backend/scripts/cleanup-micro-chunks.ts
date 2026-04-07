/**
 * cleanup-micro-chunks.ts
 *
 * Engangs-cleanup som fjerner mikro-chunks etterlatt av den gamle
 * `chunkText`-buggen i `chunk.service.ts`. Buggen lagde sliding-window
 * chunks forskjøvet med 1 tegn (typisk ~30–50 tokens hver), som forsøplet
 * både MongoDB og Pinecone-indeksen.
 *
 * Strategien:
 *   1. Finn alle ContentEmbedding-dokumenter under terskelen (default tokenCount < 30)
 *   2. Bygg Pinecone-IDer (`courseId:fileId:chunkIndex`) for hvert dokument
 *   3. Slett fra Pinecone i batches via pineconeDeleteByIds()
 *   4. Slett fra MongoDB
 *
 * Bruk:
 *   pnpm --filter backend exec tsx scripts/cleanup-micro-chunks.ts            # dry-run
 *   pnpm --filter backend exec tsx scripts/cleanup-micro-chunks.ts --apply    # utfør sletting
 *   pnpm --filter backend exec tsx scripts/cleanup-micro-chunks.ts --apply --threshold=50
 *
 * Scriptet er idempotent — kan kjøres flere ganger trygt.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { ContentEmbedding } from "../src/database/models/ContentEmbedding.js";
import { pineconeDeleteByIds } from "../src/services/pinecone.service.js";
import { logger } from "../src/utils/logger.js";

// ─── Argument-parsing ────────────────────────────────────────────
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
const TOKEN_THRESHOLD = thresholdArg
  ? Number.parseInt(thresholdArg.split("=")[1], 10)
  : 30;

if (!Number.isFinite(TOKEN_THRESHOLD) || TOKEN_THRESHOLD <= 0) {
  console.error("Ugyldig --threshold; må være et positivt heltall");
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI mangler i miljøvariabler");
  process.exit(1);
}

// ─── Hovedlogikk ─────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.info(
    { tokenThreshold: TOKEN_THRESHOLD, mode: apply ? "APPLY" : "DRY-RUN" },
    "Starter cleanup av mikro-chunks",
  );

  await mongoose.connect(MONGO_URI!);
  logger.info("Koblet til MongoDB");

  // Tell hvor mange dokumenter som vil bli berørt — gir tydelig oversikt før sletting.
  // Ekskluder full-dokument-poster (chunkIndex = -1) selv om de er korte.
  const filter = {
    tokenCount: { $lt: TOKEN_THRESHOLD },
    chunkIndex: { $gte: 0 },
    isFullDocument: { $ne: true },
  };

  const total = await ContentEmbedding.countDocuments(filter);
  logger.info({ total, tokenThreshold: TOKEN_THRESHOLD }, "Mikro-chunks funnet");

  if (total === 0) {
    logger.info("Ingen mikro-chunks å rydde — avslutter");
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    // Vis prøve så bruker kan vurdere om terskelen er fornuftig før --apply
    const sample = await ContentEmbedding.find(filter)
      .select("courseName fileName chunkIndex tokenCount text")
      .limit(10)
      .lean();
    logger.info(
      {
        sample: sample.map((s) => ({
          courseName: s.courseName,
          fileName: s.fileName,
          chunkIndex: s.chunkIndex,
          tokenCount: s.tokenCount,
          textPreview: s.text?.substring(0, 60),
        })),
      },
      "Eksempler på mikro-chunks (de første 10)",
    );
    logger.info(
      `DRY-RUN: ${total} dokumenter ville bli slettet. Kjør med --apply for å utføre.`,
    );
    await mongoose.disconnect();
    return;
  }

  // Iterer i batches for å unngå å laste alt i minnet samtidig.
  const BATCH = 500;
  let processed = 0;
  let pineconeDeleted = 0;
  let mongoDeleted = 0;

  const cursor = ContentEmbedding.find(filter)
    .select("_id courseId fileId chunkIndex")
    .lean()
    .cursor({ batchSize: BATCH });

  let batch: Array<{ _id: unknown; courseId: string; fileId: number; chunkIndex: number }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const pineconeIds = batch.map(
      (d) => `${d.courseId}:${d.fileId}:${d.chunkIndex}`,
    );
    const mongoIds = batch.map((d) => d._id);

    try {
      await pineconeDeleteByIds(pineconeIds);
      pineconeDeleted += pineconeIds.length;
    } catch (err) {
      logger.error(
        { err, batchSize: pineconeIds.length },
        "Pinecone-sletting feilet for batch — fortsetter med MongoDB-sletting",
      );
    }

    const result = await ContentEmbedding.deleteMany({ _id: { $in: mongoIds } });
    mongoDeleted += result.deletedCount ?? 0;
    processed += batch.length;
    logger.info(
      { processed, total, pineconeDeleted, mongoDeleted },
      "Cleanup-fremdrift",
    );
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc as never);
    if (batch.length >= BATCH) {
      await flush();
    }
  }
  await flush();

  logger.info(
    { total, pineconeDeleted, mongoDeleted },
    "Cleanup ferdig",
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, "Cleanup feilet");
  process.exit(1);
});

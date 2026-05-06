#!/usr/bin/env node
/*
 * reset-encrypted-data.mjs
 * ------------------------
 * Sletter ALL data som er kryptert med `ENCRYPTION_KEY` slik at du kan bytte
 * nøkkel uten å sitte igjen med uleselig data. Brukes f.eks. når warningen
 * "ENCRYPTION_KEY-validering FEILET" dukker opp etter en nøkkel-endring.
 *
 * Hva som slettes:
 *   - chathistories          (hele collection — alle chat-meldinger er kryptert)
 *   - sharedchats            (hele collection — peker mot ChatHistory)
 *   - canvasusers            (hele collection — knyttet til canvasApiToken)
 *   - User.canvasApiToken    ($unset på alle brukere — tokenet er kryptert)
 *   - User.canvasTokenHash   ($unset — tilhørende hash)
 *   - User.canvasUser        ($unset — peker mot CanvasUser-collection)
 *   - User.canvasBaseUrl     ($unset — vil settes på nytt ved re-tilkobling)
 *   - User.notionApiKey      ($unset — kryptert)
 *   - User.notionDefaultPageId ($unset — relatert til Notion-konfigurasjon)
 *
 * Hva som BEHOLDES:
 *   - Brukeridentitet (User-dokumentet med Clerk-kobling, rolle, audit, etc.)
 *   - TaskBreakdown, Arbeidsplan, ContentEmbedding, KnowledgeBase, KBContentChunk
 *   - WebPushSubscription, AuditLog, ContactMessage, StudyContext
 *   - DeletedUserTombstone, MigrationRecord
 *   - Pinecone-vektorer (ikke kryptert med ENCRYPTION_KEY)
 *   - Redis-cache (regenereres automatisk)
 *   - Clerk-brukere (uberørt)
 *
 * Bruk:
 *   pnpm db:reset-encrypted --confirm
 *
 * Uten `--confirm` printer scriptet bare hva som ville blitt slettet (dry-run).
 */

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// Last mongoose fra backend/node_modules siden den ikke finnes på rot.
// Dynamisk import med absolutt URL slik at Node ESM-resolveren finner pakken.
const mongoosePath = join(ROOT, "backend", "node_modules", "mongoose", "lib", "index.js");
if (!existsSync(mongoosePath)) {
  console.error(
    "FEIL: Fant ikke mongoose i backend/node_modules. Kjør `pnpm install` først.",
  );
  process.exit(1);
}
const mongooseModule = await import(pathToFileURL(mongoosePath).href);
const mongoose = mongooseModule.default ?? mongooseModule;

// Last MONGO_URI fra backend/.env (uten å kreve dotenv-pakken)
function loadMongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;

  const envPath = join(ROOT, "backend", ".env");
  if (!existsSync(envPath)) {
    console.error("FEIL: Fant ikke backend/.env. Sett MONGO_URI som env-variabel og kjør på nytt.");
    process.exit(1);
  }
  const contents = readFileSync(envPath, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "MONGO_URI") continue;
    let value = line.slice(eq + 1).trim();
    // Fjern omkringliggende anførselstegn
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  console.error("FEIL: MONGO_URI finnes ikke i backend/.env");
  process.exit(1);
}

const COLLECTIONS_TO_DROP = ["chathistories", "sharedchats", "canvasusers"];
const USER_FIELDS_TO_UNSET = {
  canvasApiToken: 1,
  canvasTokenHash: 1,
  canvasUser: 1,
  canvasBaseUrl: 1,
  notionApiKey: 1,
  notionDefaultPageId: 1,
};

async function main() {
  const isConfirmed = process.argv.includes("--confirm");
  const mongoUri = loadMongoUri();

  console.log("StudyWise: Reset ENCRYPTION_KEY-avhengig data");
  console.log(`Mongo URI: ${mongoUri.replace(/:([^:@/]+)@/, ":***@")}`);
  console.log("");

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
  });
  const db = mongoose.connection.db;
  if (!db) {
    console.error("FEIL: Kunne ikke koble til database.");
    process.exit(1);
  }

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);

  // Tell hva vi ville slettet
  const dropPlan = [];
  for (const name of COLLECTIONS_TO_DROP) {
    if (existingCollections.includes(name)) {
      const count = await db.collection(name).countDocuments();
      dropPlan.push({ name, count });
    }
  }

  let usersWithCanvasToken = 0;
  let usersWithNotionKey = 0;
  if (existingCollections.includes("users")) {
    usersWithCanvasToken = await db
      .collection("users")
      .countDocuments({ canvasApiToken: { $exists: true } });
    usersWithNotionKey = await db
      .collection("users")
      .countDocuments({ notionApiKey: { $exists: true } });
  }

  console.log("Plan:");
  for (const item of dropPlan) {
    console.log(`  • DROP collection \`${item.name}\` (${item.count} dokumenter)`);
  }
  if (dropPlan.length === 0) {
    console.log("  • Ingen collections å slette (allerede tomt)");
  }
  console.log(
    `  • UNSET User.canvasApiToken/canvasTokenHash/canvasUser/canvasBaseUrl på ${usersWithCanvasToken} brukere`,
  );
  console.log(
    `  • UNSET User.notionApiKey/notionDefaultPageId på ${usersWithNotionKey} brukere`,
  );
  console.log("");

  if (!isConfirmed) {
    console.log("DRY-RUN — ingenting ble endret.");
    console.log("Kjør med --confirm for å faktisk utføre operasjonen:");
    console.log("");
    console.log("  pnpm db:reset-encrypted --confirm");
    console.log("");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log("UTFØRER...");
  console.log("");

  for (const item of dropPlan) {
    await db.collection(item.name).drop();
    console.log(`  ✓ Droppet \`${item.name}\``);
  }

  if (usersWithCanvasToken > 0) {
    const result = await db.collection("users").updateMany(
      { canvasApiToken: { $exists: true } },
      {
        $unset: {
          canvasApiToken: 1,
          canvasTokenHash: 1,
          canvasUser: 1,
          canvasBaseUrl: 1,
        },
      },
    );
    console.log(`  ✓ Nullstilt Canvas-felter på ${result.modifiedCount} brukere`);
  }

  if (usersWithNotionKey > 0) {
    const result = await db.collection("users").updateMany(
      { notionApiKey: { $exists: true } },
      { $unset: { notionApiKey: 1, notionDefaultPageId: 1 } },
    );
    console.log(`  ✓ Nullstilt Notion-felter på ${result.modifiedCount} brukere`);
  }

  console.log("");
  console.log("FERDIG. Neste steg:");
  console.log("  1. Restart backend (pnpm dev)");
  console.log("  2. Logg inn på nytt — du er samme bruker");
  console.log("  3. Koble Canvas på nytt — ny token krypteres med riktig nøkkel");
  console.log("");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("");
  console.error("FEIL:", err.message);
  process.exit(1);
});

void USER_FIELDS_TO_UNSET; // hindre lint-warning siden den er dokumentasjon

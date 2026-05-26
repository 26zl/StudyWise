#!/usr/bin/env node
/*
 * nuke-studywise-data.mjs
 * -----------------------
 * Sletter alle StudyWise-kontrollerte kjøretidsdata for det konfigurerte miljøet.
 *
 * Mål:
 *   - MongoDB: slipper databasen fra MONGO_URI
 *   - Redis: tømmer den valgte Redis-databasen fra REDIS_URL
 *   - Pinecone: sletter alle records i alle namespaces for PINECONE_INDEX_NAME
 *   - Clerk: sletter alle brukere i den konfigurerte Clerk-instansen
 *
 * Den sletter ikke data hos tredjeparter utenfor appens kontroll, som Datadog,
 * PostHog, LangSmith, Cloudflare, Vercel, Heroku, Anthropic eller Cohere.
 *
 * Bruk:
 *   pnpm data:nuke
 *   pnpm data:nuke --confirm --phrase SLETT_ALT_STUDYWISE_DATA
 *
 * Valgfrie hopp:
 *   --skip-mongo
 *   --skip-redis
 *   --skip-pinecone
 *   --skip-clerk
 *
 * DNS (valgfritt):
 *   Sett NODE_DNS_SERVERS=8.8.8.8,8.8.4.4 i backend/.env hvis mongodb+srv://
 *   feiler med "querySrv ECONNREFUSED". Node bruker c-ares for DNS og plukker
 *   av og til opp en resolver som avviser SRV-oppslag; da tvinges disse serverne.
 *
 * Sikkerhet:
 *   - Standardmodus er tørrkjøring (dry-run).
 *   - Reell sletting krever --confirm og den eksakte frasen over.
 *   - MongoDB-databasenavnet må inneholde "studywise" eller "studwize" med mindre
 *     --allow-non-studywise-db sendes med bevisst.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setServers } from "node:dns";

const REQUIRED_PHRASE = "SLETT_ALT_STUDYWISE_DATA";
const DEFAULT_PINECONE_NAMESPACE = "__default__";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const BACKEND_DIR = join(ROOT, "backend");
const backendRequire = createRequire(join(BACKEND_DIR, "package.json"));

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function getArgValue(name) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function printHelp() {
  console.log(`StudyWise data-nuke

Tørrkjøring (sletter ingenting):
  pnpm data:nuke

Slett faktisk alle konfigurerte StudyWise-appdata:
  pnpm data:nuke --confirm --phrase ${REQUIRED_PHRASE}

Hopp over et mål:
  pnpm data:nuke --confirm --phrase ${REQUIRED_PHRASE} --skip-clerk

Mål:
  MongoDB   slipper databasen fra MONGO_URI
  Redis     FLUSHDB for REDIS_URL
  Pinecone  sletter alle records i namespacene til PINECONE_INDEX_NAME
  Clerk     sletter alle brukere i den konfigurerte Clerk-instansen

Manuell oppfølging:
  Slett/utløp lagrede logger og analyse i eksterne leverandør-dashboards
  hvis du trenger de borte også.
`);
}

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return false;
  const contents = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq < 0) continue;

    const key = normalized.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

// Tvinger Node/c-ares til bestemte DNS-servere når NODE_DNS_SERVERS er satt.
// Uten dette ignorerer Node variabelen, og mongodb+srv:// kan feile med
// "querySrv ECONNREFUSED" selv om systemets DNS løser SRV-recorden fint.
function applyDnsServers() {
  const raw = process.env.NODE_DNS_SERVERS?.trim();
  if (!raw) return;
  const servers = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (servers.length === 0) return;
  setServers(servers);
  console.log(`DNS: bruker ${servers.join(", ")} (fra NODE_DNS_SERVERS)`);
}

function maskSecret(value) {
  if (!value) return "(mangler)";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function maskUri(uri) {
  if (!uri) return "(mangler)";
  return uri.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/u, "//***:***@");
}

function requireBackendPackage(name) {
  try {
    return backendRequire(name);
  } catch (error) {
    throw new Error(
      `Mangler backend-avhengighet "${name}". Kjør "pnpm install" før du bruker dette scriptet.`,
      { cause: error },
    );
  }
}

function assertMongoDbLooksLikeStudyWise(dbName) {
  if (hasFlag("allow-non-studywise-db")) return;
  if (/studywise|studwize/iu.test(dbName)) return;
  throw new Error(
    `Nekter å slippe MongoDB-databasen "${dbName}". ` +
      `Databasenavnet må inneholde "studywise" eller "studwize", ` +
      `eller send --allow-non-studywise-db bevisst.`,
  );
}

function normalizePineconeNamespaceForDelete(namespace) {
  return namespace === "" ? DEFAULT_PINECONE_NAMESPACE : namespace;
}

function failIfMissingEnv(target, envNames) {
  const missing = envNames.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return;
  throw new Error(
    `${target} er aktivert, men mangler miljøvariabel(er): ${missing.join(", ")}. ` +
      `Sett dem eller send --skip-${target.toLowerCase()}.`,
  );
}

function buildTargets() {
  return {
    mongo: !hasFlag("skip-mongo"),
    redis: !hasFlag("skip-redis"),
    pinecone: !hasFlag("skip-pinecone"),
    clerk: !hasFlag("skip-clerk"),
  };
}

async function planMongo() {
  failIfMissingEnv("Mongo", ["MONGO_URI"]);
  const mongoose = requireBackendPackage("mongoose");

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB-tilkoblingen eksponerte ikke noe databasehåndtak.");
  assertMongoDbLooksLikeStudyWise(db.databaseName);

  const collections = await db.listCollections().toArray();
  const details = [];
  for (const collection of collections) {
    const count = await db.collection(collection.name).estimatedDocumentCount();
    details.push({ name: collection.name, count });
  }

  return {
    name: "MongoDB",
    uri: maskUri(process.env.MONGO_URI),
    databaseName: db.databaseName,
    collectionCount: details.length,
    documentCount: details.reduce((sum, item) => sum + item.count, 0),
    details,
    async execute() {
      const result = await db.dropDatabase();
      return { dropped: result };
    },
    async close() {
      await mongoose.disconnect();
    },
  };
}

async function planRedis() {
  failIfMissingEnv("Redis", ["REDIS_URL"]);
  const { createClient } = requireBackendPackage("redis");
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 15_000, reconnectStrategy: false },
  });

  client.on("error", () => {
    // Vis tilkoblingsfeil via awaited kommandoer i stedet for støyende event-logger.
  });

  await client.connect();
  const keyCount = Number(await client.sendCommand(["DBSIZE"]));

  return {
    name: "Redis",
    uri: maskUri(process.env.REDIS_URL),
    keyCount,
    async execute() {
      await client.sendCommand(["FLUSHDB"]);
      return { flushedDb: true };
    },
    async close() {
      if (client.isOpen) await client.quit();
    },
  };
}

async function planPinecone() {
  failIfMissingEnv("Pinecone", ["PINECONE_API_KEY", "PINECONE_INDEX_NAME"]);
  const { Pinecone } = requireBackendPackage("@pinecone-database/pinecone");
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const indexName = process.env.PINECONE_INDEX_NAME.trim();
  const index = pc.index({ name: indexName });
  const stats = await index.describeIndexStats();
  const namespaceEntries = Object.entries(stats.namespaces ?? {});
  const namespaces =
    namespaceEntries.length > 0
      ? namespaceEntries.map(([name, summary]) => ({
          name: normalizePineconeNamespaceForDelete(name),
          recordCount: Number(summary?.recordCount ?? 0),
        }))
      : [{ name: DEFAULT_PINECONE_NAMESPACE, recordCount: 0 }];

  return {
    name: "Pinecone",
    indexName,
    namespaceCount: namespaces.length,
    recordCount: namespaces.reduce((sum, item) => sum + item.recordCount, 0),
    namespaces,
    async execute() {
      const deleted = [];
      const skipped = [];
      for (const namespace of namespaces) {
        try {
          await index.deleteAll({ namespace: namespace.name });
          deleted.push(namespace.name);
        } catch (error) {
          // Pinecone svarer 404 hvis namespacet ikke finnes — f.eks. når det
          // allerede er tomt/slettet fra en tidligere kjøring (tomme namespaces
          // fjernes automatisk). Idempotent-trygt å hoppe over; alt annet kastes videre.
          const status = error?.status ?? error?.cause?.status;
          const is404 = status === 404 || String(error?.message ?? "").includes("404");
          if (!is404) throw error;
          skipped.push(namespace.name);
        }
      }
      return { deletedNamespaces: deleted, skippedMissingNamespaces: skipped };
    },
    async close() {
      // Pinecone-SDK-en holder ingen eksplisitt tilkobling åpen.
    },
  };
}

async function listAllClerkUserIds(clerk) {
  const ids = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const page = await clerk.users.getUserList({ limit, offset });
    const pageIds = (page.data ?? []).map((user) => user.id).filter(Boolean);
    ids.push(...pageIds);

    if (pageIds.length === 0 || ids.length >= page.totalCount) break;
    offset += pageIds.length;
  }

  return ids;
}

async function planClerk() {
  failIfMissingEnv("Clerk", ["CLERK_SECRET_KEY"]);
  const { createClerkClient } = requireBackendPackage("@clerk/backend");
  const secretKey = process.env.CLERK_SECRET_KEY.trim();
  const clerk = createClerkClient({ secretKey });
  const userIds = await listAllClerkUserIds(clerk);

  return {
    name: "Clerk",
    secretKey: maskSecret(secretKey),
    userCount: userIds.length,
    userIds,
    async execute() {
      const deleted = [];
      for (const userId of userIds) {
        await clerk.users.deleteUser(userId);
        deleted.push(userId);
      }
      return { deletedUsers: deleted.length };
    },
    async close() {
      // Clerk-SDK-en holder ingen eksplisitt tilkobling åpen.
    },
  };
}

function printPlan(plans, targets, isConfirmed) {
  console.log("StudyWise data-nuke");
  console.log(isConfirmed ? "Modus: BEKREFTET SLETTING" : "Modus: TØRRKJØRING");
  console.log("");
  console.log("Anbefalt før bekreftet sletting:");
  console.log("  1. Stopp backend/workers så ingen nye data skrives under oppryddingen.");
  console.log("  2. Bekreft at backend/.env peker på miljøet du vil slette.");
  console.log("");

  if (!targets.mongo) console.log("MongoDB: hoppet over via flagg");
  if (!targets.redis) console.log("Redis: hoppet over via flagg");
  if (!targets.pinecone) console.log("Pinecone: hoppet over via flagg");
  if (!targets.clerk) console.log("Clerk: hoppet over via flagg");
  if (!targets.mongo || !targets.redis || !targets.pinecone || !targets.clerk) console.log("");

  for (const plan of plans) {
    if (plan.name === "MongoDB") {
      console.log(`MongoDB: ${plan.uri}`);
      console.log(
        `  database=${plan.databaseName} samlinger=${plan.collectionCount} dokumenter~=${plan.documentCount}`,
      );
      for (const item of plan.details.slice(0, 12)) {
        console.log(`  - ${item.name}: ${item.count}`);
      }
      if (plan.details.length > 12) {
        console.log(`  - ... ${plan.details.length - 12} samling(er) til`);
      }
      console.log("");
    }

    if (plan.name === "Redis") {
      console.log(`Redis: ${plan.uri}`);
      console.log(`  nøkler=${plan.keyCount}`);
      console.log("");
    }

    if (plan.name === "Pinecone") {
      console.log(`Pinecone: index=${plan.indexName}`);
      console.log(`  namespaces=${plan.namespaceCount} records~=${plan.recordCount}`);
      for (const namespace of plan.namespaces) {
        console.log(`  - ${namespace.name}: ${namespace.recordCount}`);
      }
      console.log("");
    }

    if (plan.name === "Clerk") {
      console.log(`Clerk: secret=${plan.secretKey}`);
      console.log(`  brukere=${plan.userCount}`);
      console.log("");
    }
  }

  if (!isConfirmed) {
    console.log("TØRRKJØRING: ingenting ble slettet.");
    console.log("");
    console.log("For å faktisk slette alt konfigurert over:");
    console.log(`  pnpm data:nuke --confirm --phrase ${REQUIRED_PHRASE}`);
    console.log("");
  }
}

async function closePlans(plans) {
  for (const plan of plans.toReversed()) {
    try {
      await plan.close();
    } catch (error) {
      console.warn(`Advarsel: kunne ikke lukke ${plan.name}:`, error.message);
    }
  }
}

async function main() {
  loadDotEnvFile(join(BACKEND_DIR, ".env"));
  applyDnsServers();

  const targets = buildTargets();
  const isConfirmed = hasFlag("confirm");
  const phrase = getArgValue("phrase");

  if (isConfirmed && phrase !== REQUIRED_PHRASE) {
    throw new Error(`Nekter å slette. Send den eksakte frasen: --phrase ${REQUIRED_PHRASE}`);
  }

  const plans = [];
  try {
    if (targets.clerk) plans.push(await planClerk());
    if (targets.pinecone) plans.push(await planPinecone());
    if (targets.redis) plans.push(await planRedis());
    if (targets.mongo) plans.push(await planMongo());

    printPlan(plans, targets, isConfirmed);

    if (!isConfirmed) return;

    console.log("Sletter...");
    for (const plan of plans) {
      const result = await plan.execute();
      console.log(`  OK ${plan.name}: ${JSON.stringify(result)}`);
    }
    console.log("");
    console.log("Ferdig. StudyWise-kontrollerte appdata for dette miljøet er slettet.");
    console.log(
      "Husk å håndtere ekstern leverandør-retensjon separat hvis du trenger logger/analyse slettet også.",
    );
  } finally {
    await closePlans(plans);
  }
}

main().catch((error) => {
  console.error("");
  console.error("FEIL:", error.message);
  if (error.cause?.message) console.error("Årsak:", error.cause.message);
  process.exit(1);
});

#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Auth Database Invariant Checker
 *
 * Connects to MongoDB, verifies User collection indexes and data integrity.
 * Detects duplicate emails, usernames, clerkIds, OAuth identities, and
 * inconsistent/lingering fields on deleted users.
 *
 * Usage: pnpm test:auth:db
 * Exit code 0 = all invariants pass, 1 = violations found.
 */
import "../helpers/env.js";
import mongoose, { type ConnectOptions } from "mongoose";
import { log, header } from "../helpers/log.js";

// ---------- Types for report ----------
interface IndexInfo {
  name: string;
  key: Record<string, unknown>;
  unique: boolean;
  sparse: boolean;
}

interface DuplicateGroup {
  value: unknown;
  count: number;
  ids: string[];
  clerkIds: (string | undefined)[];
}

interface MalformedUser {
  _id: string;
  username?: string;
  usernameNormalized?: string;
  issue: string;
}

interface LingeringDeletedUser {
  _id: string;
  deletedAt: Date;
  lingeringFields: string[];
}

interface Report {
  timestamp: string;
  indexesFound: IndexInfo[];
  requiredIndexes: { name: string; found: boolean; correct: boolean }[];
  missingIndexes: string[];
  duplicateEmails: DuplicateGroup[];
  duplicateUsernameNormalized: DuplicateGroup[];
  duplicateClerkIds: DuplicateGroup[];
  duplicateOAuthIdentities: DuplicateGroup[];
  malformedUsers: MalformedUser[];
  lingeringDeletedUsers: LingeringDeletedUser[];
  stats: { total: number; active: number; deleted: number };
  passed: boolean;
}

// ---------- Constants ----------
const REQUIRED_INDEXES: Record<string, { key: Record<string, number>; unique: boolean; sparse: boolean }> = {
  email_1: { key: { email: 1 }, unique: true, sparse: false },
  clerk_id_unique: { key: { clerkId: 1 }, unique: true, sparse: true },
  username_normalized_unique: { key: { usernameNormalized: 1 }, unique: true, sparse: true },
  oauth_accounts_provider_account_id_unique: {
    key: { "oauthAccounts.provider": 1, "oauthAccounts.providerAccountId": 1 },
    unique: true,
    sparse: true,
  },
};

const IDENTITY_FIELDS_SHOULD_BE_UNSET = [
  "clerkId",
  "oauthAccounts",
  "username",
  "usernameNormalized",
  "firstName",
  "lastName",
  "authProvider",
];

// ---------- Helpers ----------
function keysMatch(actual: Record<string, unknown>, expected: Record<string, number>): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((k, i) => k === expectedKeys[i] && Number(actual[k]) === expected[k]);
}

// ---------- Main ----------
async function main(): Promise<Report> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    log("ERROR: MONGO_URI is not set in environment");
    process.exit(1);
  }

  log("Connecting to MongoDB...");
  const connectOptions: ConnectOptions = {
    serverApi: { version: "1" as const, strict: true, deprecationErrors: true },
    serverSelectionTimeoutMS: 10000,
  };
  await mongoose.connect(mongoUri, connectOptions);
  log("Connected.");

  const db = mongoose.connection.db;
  if (!db) {
    log("ERROR: No database handle");
    process.exit(1);
  }

  const collection = db.collection("users");
  const report: Report = {
    timestamp: new Date().toISOString(),
    indexesFound: [],
    requiredIndexes: [],
    missingIndexes: [],
    duplicateEmails: [],
    duplicateUsernameNormalized: [],
    duplicateClerkIds: [],
    duplicateOAuthIdentities: [],
    malformedUsers: [],
    lingeringDeletedUsers: [],
    stats: { total: 0, active: 0, deleted: 0 },
    passed: true,
  };

  // ---- 1. Indexes ----
  header("INDEX VERIFICATION");
  const rawIndexes = await collection.indexes();
  report.indexesFound = rawIndexes.map((idx) => ({
    name: idx.name ?? "unnamed",
    key: idx.key as Record<string, unknown>,
    unique: !!idx.unique,
    sparse: !!idx.sparse,
  }));

  for (const [name, expected] of Object.entries(REQUIRED_INDEXES)) {
    const found = rawIndexes.find((idx) => idx.name === name);
    const exists = !!found;
    const correct = exists && keysMatch(found!.key as Record<string, unknown>, expected.key) && !!found!.unique === expected.unique && !!found!.sparse === expected.sparse;
    report.requiredIndexes.push({ name, found: exists, correct });
    if (!exists) {
      report.missingIndexes.push(name);
      report.passed = false;
      log(`  FAIL: Required index "${name}" is MISSING`);
    } else if (!correct) {
      report.passed = false;
      log(`  FAIL: Index "${name}" exists but definition does not match expected`);
    } else {
      log(`  OK: "${name}" — unique=${expected.unique}, sparse=${expected.sparse}`);
    }
  }

  // ---- 2. Stats ----
  header("COLLECTION STATS");
  report.stats.total = await collection.countDocuments();
  report.stats.active = await collection.countDocuments({ deletedAt: { $exists: false } });
  report.stats.deleted = report.stats.total - report.stats.active;
  log(`  Total users:   ${report.stats.total}`);
  log(`  Active users:  ${report.stats.active}`);
  log(`  Deleted users: ${report.stats.deleted}`);

  // ---- 3. Duplicate emails ----
  header("DUPLICATE EMAILS (active)");
  const emailDupes: DuplicateGroup[] = await collection.aggregate([
    { $match: { deletedAt: { $exists: false } } },
    { $group: { _id: "$email", count: { $sum: 1 }, ids: { $push: { $toString: "$_id" } }, clerkIds: { $push: "$clerkId" } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, value: "$_id", count: 1, ids: 1, clerkIds: 1 } },
  ]).toArray() as DuplicateGroup[];
  report.duplicateEmails = emailDupes;
  if (emailDupes.length > 0) {
    report.passed = false;
    for (const d of emailDupes) log(`  FAIL: email "${String(d.value)}" appears ${d.count} times — ids: ${d.ids.join(", ")}`);
  } else {
    log("  OK: No duplicate emails");
  }

  // ---- 4. Duplicate usernames ----
  header("DUPLICATE USERNAME_NORMALIZED (active)");
  const usernameDupes: DuplicateGroup[] = await collection.aggregate([
    { $match: { deletedAt: { $exists: false }, usernameNormalized: { $exists: true, $ne: null } } },
    { $group: { _id: "$usernameNormalized", count: { $sum: 1 }, ids: { $push: { $toString: "$_id" } }, clerkIds: { $push: "$clerkId" } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, value: "$_id", count: 1, ids: 1, clerkIds: 1 } },
  ]).toArray() as DuplicateGroup[];
  report.duplicateUsernameNormalized = usernameDupes;
  if (usernameDupes.length > 0) {
    report.passed = false;
    for (const d of usernameDupes) log(`  FAIL: usernameNormalized "${String(d.value)}" appears ${d.count} times — ids: ${d.ids.join(", ")}`);
  } else {
    log("  OK: No duplicate usernames");
  }

  // ---- 5. Duplicate clerkIds ----
  header("DUPLICATE CLERK IDS (active)");
  const clerkIdDupes: DuplicateGroup[] = await collection.aggregate([
    { $match: { deletedAt: { $exists: false }, clerkId: { $exists: true, $ne: null } } },
    { $group: { _id: "$clerkId", count: { $sum: 1 }, ids: { $push: { $toString: "$_id" } }, clerkIds: { $push: "$clerkId" } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, value: "$_id", count: 1, ids: 1, clerkIds: 1 } },
  ]).toArray() as DuplicateGroup[];
  report.duplicateClerkIds = clerkIdDupes;
  if (clerkIdDupes.length > 0) {
    report.passed = false;
    for (const d of clerkIdDupes) log(`  FAIL: clerkId "${String(d.value)}" appears ${d.count} times — ids: ${d.ids.join(", ")}`);
  } else {
    log("  OK: No duplicate clerkIds");
  }

  // ---- 6. Duplicate OAuth identities ----
  header("DUPLICATE OAUTH IDENTITIES (active)");
  const oauthDupes: DuplicateGroup[] = await collection.aggregate([
    { $match: { deletedAt: { $exists: false }, "oauthAccounts.0": { $exists: true } } },
    { $unwind: "$oauthAccounts" },
    {
      $group: {
        _id: { provider: "$oauthAccounts.provider", providerAccountId: "$oauthAccounts.providerAccountId" },
        count: { $sum: 1 },
        ids: { $push: { $toString: "$_id" } },
        clerkIds: { $push: "$clerkId" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, value: "$_id", count: 1, ids: 1, clerkIds: 1 } },
  ]).toArray() as DuplicateGroup[];
  report.duplicateOAuthIdentities = oauthDupes;
  if (oauthDupes.length > 0) {
    report.passed = false;
    for (const d of oauthDupes) log(`  FAIL: OAuth ${JSON.stringify(d.value)} appears ${d.count} times — ids: ${d.ids.join(", ")}`);
  } else {
    log("  OK: No duplicate OAuth identities");
  }

  // ---- 7. Malformed username normalization ----
  header("USERNAME NORMALIZATION CONSISTENCY");
  const allWithUsername = await collection.find(
    { deletedAt: { $exists: false }, username: { $exists: true, $ne: null } },
    { projection: { _id: 1, username: 1, usernameNormalized: 1 } },
  ).toArray();

  for (const doc of allWithUsername) {
    const _id = String(doc._id);
    const username = doc.username as string;
    const normalized = doc.usernameNormalized as string | undefined;
    const expected = username.toLowerCase().trim();

    if (!normalized) {
      report.malformedUsers.push({ _id, username, usernameNormalized: undefined, issue: "username exists but usernameNormalized is missing" });
      report.passed = false;
    } else if (normalized !== expected) {
      report.malformedUsers.push({ _id, username, usernameNormalized: normalized, issue: `usernameNormalized "${normalized}" does not match expected "${expected}"` });
      report.passed = false;
    }
  }

  const normalizedWithoutUsername = await collection.find(
    { deletedAt: { $exists: false }, usernameNormalized: { $exists: true, $ne: null }, username: { $exists: false } },
    { projection: { _id: 1, usernameNormalized: 1 } },
  ).toArray();
  for (const doc of normalizedWithoutUsername) {
    report.malformedUsers.push({
      _id: String(doc._id),
      usernameNormalized: doc.usernameNormalized as string,
      issue: "usernameNormalized exists but username is missing",
    });
    report.passed = false;
  }

  if (report.malformedUsers.length > 0) {
    for (const m of report.malformedUsers) log(`  FAIL: User ${m._id} — ${m.issue}`);
  } else {
    log("  OK: All usernames consistently normalized");
  }

  // ---- 8. Deleted users with lingering identity fields ----
  header("DELETED USERS WITH LINGERING IDENTITY FIELDS");
  const deletedUsers = await collection.find(
    { deletedAt: { $exists: true } },
    { projection: { _id: 1, deletedAt: 1, clerkId: 1, oauthAccounts: 1, username: 1, usernameNormalized: 1, firstName: 1, lastName: 1, authProvider: 1 } },
  ).toArray();

  for (const doc of deletedUsers) {
    const lingering: string[] = [];
    for (const field of IDENTITY_FIELDS_SHOULD_BE_UNSET) {
      const val = (doc as Record<string, unknown>)[field];
      if (val !== undefined && val !== null) {
        if (field === "oauthAccounts" && Array.isArray(val) && val.length === 0) continue;
        lingering.push(field);
      }
    }
    if (lingering.length > 0) {
      report.lingeringDeletedUsers.push({
        _id: String(doc._id),
        deletedAt: doc.deletedAt as Date,
        lingeringFields: lingering,
      });
      report.passed = false;
    }
  }

  if (report.lingeringDeletedUsers.length > 0) {
    for (const d of report.lingeringDeletedUsers) log(`  WARN: Deleted user ${d._id} still has: ${d.lingeringFields.join(", ")}`);
  } else {
    log("  OK: No deleted users with lingering identity fields");
  }

  // ---- Summary ----
  header("SUMMARY");
  log(`  Passed: ${report.passed ? "YES" : "NO"}`);
  log(`  Missing indexes:              ${report.missingIndexes.length}`);
  log(`  Duplicate emails:             ${report.duplicateEmails.length}`);
  log(`  Duplicate usernames:          ${report.duplicateUsernameNormalized.length}`);
  log(`  Duplicate clerkIds:           ${report.duplicateClerkIds.length}`);
  log(`  Duplicate OAuth identities:   ${report.duplicateOAuthIdentities.length}`);
  log(`  Malformed normalizations:     ${report.malformedUsers.length}`);
  log(`  Lingering deleted user fields: ${report.lingeringDeletedUsers.length}`);

  return report;
}

main()
  .then((report) => {
    log(`\nFull JSON report:\n${JSON.stringify(report, null, 2)}`);
    return mongoose.disconnect().then(() => {
      process.exit(report.passed ? 0 : 1);
    });
  })
  .catch((err) => {
    process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

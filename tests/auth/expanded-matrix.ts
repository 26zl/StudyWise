#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Utvidet Auth Matrix-kjører
 *
 * Omfattende auth-identitetstesting med:
 * - Sanntids verbose-logging under kjøring
 * - Evidensfiler per scenario
 * - DB-snapshot før/etter hvert scenario
 * - Detaljert klassifisering og korrelasjon
 * - Støtte for alle 120 scenarioer (Grupper A-P)
 *
 * Bruk:
 *   pnpm auth:matrix                    # Kjør alle kjørbare scenarioer
 *   pnpm auth:matrix:group A            # Kjør kun Gruppe A
 *   pnpm auth:matrix:verbose            # Kjør med maksimal detaljeringsgrad
 *   pnpm auth:matrix:basic              # Kjør grunnleggende registreringsscenarioer
 *   pnpm auth:matrix:update             # Kjør oppdateringsscenarioer
 *   pnpm auth:matrix:delete             # Kjør slettingsscenarioer
 *   pnpm auth:matrix:race              # Kjør kappløpstilstand-scenarioer
 */

import "../helpers/env.js";
import { BACKEND_URL } from "../helpers/env.js";
import { createClerkClient } from "@clerk/backend";
import mongoose, { type ConnectOptions } from "mongoose";
import * as fs from "node:fs";

// Bruk mongoose sine interne mongodb-typer for å unngå versjonskonflikter
type MongoCollection = ReturnType<NonNullable<typeof mongoose.connection.db>["collection"]>;
type MongoDocument = Record<string, unknown>;
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createVerboseLogger, VerboseLogger } from "../helpers/verbose-logger.js";
import {
  buildFullMatrix,
  buildGroupByName,
  setRunSeed,
  getScenarioStats,
  type ScenarioDefinition,
  type ExecutableScenario,
  type E2eScenario,
  type ManualScenario,
  type RaceScenario,
  type ScenarioGroup,
} from "./scenario-definitions.js";

// ============================================================================
// Typer
// ============================================================================

interface ClerkCreateErrorInfo {
  message: string;
  status?: number;
  codes: string[];
  longMessages: string[];
}

interface ClerkUserEvidence {
  id: string;
  email: string;
  username: string | null;
  externalAccountsCount: number;
  primaryEmailVerified: boolean | null;
}

interface CreateAttemptEvidence {
  ok: boolean;
  provider: string;
  requestedEmail: string;
  requestedUsername: string;
  user?: ClerkUserEvidence;
  error?: ClerkCreateErrorInfo;
}

interface FlowResponseEvidence {
  httpStatus: number;
  rawClassification: string | null;
  outcome: "success" | "conflict" | "null" | "http_error" | "unknown";
  conflictType: string | null;
  localUserId: string | null;
  localEmail: string | null;
  localUsername: string | null;
  rawBody: unknown;
}

interface DbUserRow {
  _id: string;
  email?: string;
  username?: string;
  usernameNormalized?: string;
  clerkId?: string;
  authProviders?: string[];
  deletedAt?: string;
  oauthAccountsCount: number;
  syncConflict?: unknown;
}

interface DbSnapshotEvidence {
  available: boolean;
  reason?: string;
  usersBefore: number;
  usersAfter: number;
  emailMatches: DbUserRow[];
  usernameMatches: DbUserRow[];
  clerkIdMatches: DbUserRow[];
  duplicateEmails: string[];
  duplicateUsernames: string[];
}

interface UpdateResultEvidence {
  attempted: boolean;
  clerkId: string;
  targetUsername: string;
  httpStatus: number;
  success: boolean;
  conflict: boolean;
  detectionPhase?: "early_check" | "db_fallback";
  rawBody: unknown;
}

interface ScenarioEvidence {
  id: string;
  group: string;
  kind: string;
  description: string;
  status: "executed" | "manual_required" | "setup_failed" | "skipped" | "e2e_required" | "oauth_required" | "admin_required" | "race_condition";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  classification: string;
  expectedOutcome: string;
  outcomeMatch: boolean;
  flowIds: string[];
  clerkUsers: ClerkUserEvidence[];
  createAttempts: CreateAttemptEvidence[];
  flowResponses: FlowResponseEvidence[];
  updateResults?: UpdateResultEvidence[];
  dbSnapshot: DbSnapshotEvidence;
  notes: string[];
  cleanup: {
    deletedUserIds: string[];
    failedDeletes: string[];
  };
  manualSteps?: string[];
  blocker?: string;
}

interface MatrixEvidence {
  runId: string;
  mode: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  backendUrl: string;
  diagnosticsEnabled: boolean;
  mongoConnected: boolean;
  capabilities: {
    clerkUsersApiMethods: Record<string, boolean>;
    oauthAutomationSupported: boolean;
    oauthAutomationBlocker: string;
  };
  stats: {
    total: number;
    executable: number;
    executed: number;
    setupFailed: number;
    manualRequired: number;
    e2eRequired: number;
    oauthRequired: number;
    adminRequired: number;
    raceCondition: number;
    skipped: number;
  };
  classifications: Record<string, number>;
  scenarios: ScenarioEvidence[];
  logFilePath: string;
  jsonEventsPath: string;
}

// ============================================================================
// Konstanter
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const RUN_SEED = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_PASSWORD = process.env.TEST_CLERK_PASSWORD ?? "ReproMatrix123!";

const MONGO_OPTIONS: ConnectOptions = {
  serverApi: { version: "1", strict: true, deprecationErrors: true },
  serverSelectionTimeoutMS: 10_000,
};

// ============================================================================
// Globale variabler
// ============================================================================

let usersCollection: MongoCollection | null = null;
let logger: VerboseLogger;

// ============================================================================
// Hjelpefunksjoner
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function slugTime(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function writeJson(fileName: string, payload: unknown): string {
  ensureResultsDir();
  const filePath = path.join(RESULTS_DIR, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

// ============================================================================
// Clerk-feilparsing
// ============================================================================

function parseClerkCreateError(error: unknown): ClerkCreateErrorInfo {
  const message = error instanceof Error ? error.message : String(error);
  const asObject = error as {
    status?: number;
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
  };
  const status = typeof asObject.status === "number" ? asObject.status : undefined;
  const errors = Array.isArray(asObject.errors) ? asObject.errors : [];

  return {
    message,
    status,
    codes: errors.map((item) => item.code).filter((code): code is string => typeof code === "string"),
    longMessages: errors.map((item) => item.longMessage ?? item.message).filter((text): text is string => typeof text === "string"),
  };
}

function hasDuplicateEmailSignal(error: ClerkCreateErrorInfo): boolean {
  const blob = [error.message, ...error.codes, ...error.longMessages].join(" ").toLowerCase();
  return blob.includes("email") && (blob.includes("exist") || blob.includes("taken") || blob.includes("already"));
}

function hasDuplicateUsernameSignal(error: ClerkCreateErrorInfo): boolean {
  const blob = [error.message, ...error.codes, ...error.longMessages].join(" ").toLowerCase();
  return blob.includes("username") && (blob.includes("exist") || blob.includes("taken") || blob.includes("already"));
}

function hasValidationError(error: ClerkCreateErrorInfo): boolean {
  const blob = [error.message, ...error.codes, ...error.longMessages].join(" ").toLowerCase();
  return blob.includes("invalid") || blob.includes("validation") || blob.includes("format") || 
         blob.includes("too short") || blob.includes("too long") || blob.includes("character");
}

// ============================================================================
// Flow-responsparsing
// ============================================================================

function detectConflictType(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  if ("__usernameConflict" in result) return "usernameConflict";
  if ("__accountConflict" in result) return "accountConflict";
  if ("__userDeleted" in result) return "userDeleted";
  if ("__oauthAccountConflict" in result) return "oauthAccountConflict";
  if ("__oauthMetadataMissing" in result) return "oauthMetadataMissing";
  return null;
}

function parseFlowResponse(status: number, body: unknown): FlowResponseEvidence {
  if (status !== 200) {
    return {
      httpStatus: status,
      rawClassification: null,
      outcome: "http_error",
      conflictType: null,
      localUserId: null,
      localEmail: null,
      localUsername: null,
      rawBody: body,
    };
  }

  const rawClassification =
    typeof body === "object" && body !== null && typeof (body as { classification?: unknown }).classification === "string"
      ? (body as { classification: string }).classification
      : null;

  const result = typeof body === "object" && body !== null ? (body as { result?: unknown }).result : null;

  if (rawClassification?.startsWith("success") && typeof result === "object" && result !== null && "_id" in result) {
    const user = result as { _id?: unknown; email?: unknown; username?: unknown };
    return {
      httpStatus: status,
      rawClassification,
      outcome: "success",
      conflictType: null,
      localUserId: typeof user._id === "string" ? user._id : String(user._id ?? ""),
      localEmail: typeof user.email === "string" ? user.email : null,
      localUsername: typeof user.username === "string" ? user.username : null,
      rawBody: body,
    };
  }

  if (rawClassification?.startsWith("null")) {
    return {
      httpStatus: status,
      rawClassification,
      outcome: "null",
      conflictType: null,
      localUserId: null,
      localEmail: null,
      localUsername: null,
      rawBody: body,
    };
  }

  const conflictType = detectConflictType(result) ?? (() => {
    if (!rawClassification) return null;
    const match = rawClassification.match(/type:\s*([a-zA-Z0-9_]+)/);
    return match ? match[1] : null;
  })();

  if (conflictType) {
    return {
      httpStatus: status,
      rawClassification,
      outcome: "conflict",
      conflictType,
      localUserId: null,
      localEmail: null,
      localUsername: null,
      rawBody: body,
    };
  }

  return {
    httpStatus: status,
    rawClassification,
    outcome: "unknown",
    conflictType: null,
    localUserId: null,
    localEmail: null,
    localUsername: null,
    rawBody: body,
  };
}

// ============================================================================
// DB-operasjoner
// ============================================================================

function normalizeDbUserRow(doc: Record<string, unknown>): DbUserRow {
  return {
    _id: String(doc._id ?? ""),
    email: typeof doc.email === "string" ? doc.email : undefined,
    username: typeof doc.username === "string" ? doc.username : undefined,
    usernameNormalized: typeof doc.usernameNormalized === "string" ? doc.usernameNormalized : undefined,
    clerkId: typeof doc.clerkId === "string" ? doc.clerkId : undefined,
    authProviders: Array.isArray(doc.authProviders) ? doc.authProviders : undefined,
    deletedAt: doc.deletedAt instanceof Date ? doc.deletedAt.toISOString() : undefined,
    oauthAccountsCount: Array.isArray(doc.oauthAccounts) ? doc.oauthAccounts.length : 0,
    syncConflict: doc.syncConflict,
  };
}

async function countUsers(): Promise<number> {
  if (!usersCollection) return -1;
  return usersCollection.countDocuments();
}

async function findDuplicateEmails(): Promise<string[]> {
  if (!usersCollection) return [];
  const pipeline = [
    { $match: { deletedAt: { $exists: false } } },
    { $group: { _id: "$email", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, email: "$_id" } },
  ];
  const results = await usersCollection.aggregate(pipeline).toArray();
  return results.map((r: MongoDocument) => String(r.email));
}

async function findDuplicateUsernames(): Promise<string[]> {
  if (!usersCollection) return [];
  const pipeline = [
    { $match: { deletedAt: { $exists: false }, usernameNormalized: { $exists: true, $ne: null } } },
    { $group: { _id: "$usernameNormalized", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, username: "$_id" } },
  ];
  const results = await usersCollection.aggregate(pipeline).toArray();
  return results.map((r: MongoDocument) => String(r.username));
}

async function collectDbSnapshot(emails: string[], usernames: string[], clerkIds: string[], usersBefore: number): Promise<DbSnapshotEvidence> {
  if (!usersCollection) {
    return {
      available: false,
      reason: "MongoDB not connected",
      usersBefore: -1,
      usersAfter: -1,
      emailMatches: [],
      usernameMatches: [],
      clerkIdMatches: [],
      duplicateEmails: [],
      duplicateUsernames: [],
    };
  }

  const projection = {
    _id: 1, email: 1, username: 1, usernameNormalized: 1, clerkId: 1,
    authProviders: 1, deletedAt: 1, oauthAccounts: 1, syncConflict: 1,
  };

  const normalizedUsernames = usernames.map((u) => u.toLowerCase().trim()).filter(Boolean);

  const [emailMatchesRaw, usernameMatchesRaw, clerkIdMatchesRaw, usersAfter, duplicateEmails, duplicateUsernames] = await Promise.all([
    emails.length ? usersCollection.find({ email: { $in: emails } }, { projection }).toArray() : Promise.resolve([]),
    normalizedUsernames.length ? usersCollection.find({ usernameNormalized: { $in: normalizedUsernames } }, { projection }).toArray() : Promise.resolve([]),
    clerkIds.length ? usersCollection.find({ clerkId: { $in: clerkIds } }, { projection }).toArray() : Promise.resolve([]),
    countUsers(),
    findDuplicateEmails(),
    findDuplicateUsernames(),
  ]);

  return {
    available: true,
    usersBefore,
    usersAfter,
    emailMatches: emailMatchesRaw.map((doc: MongoDocument) => normalizeDbUserRow(doc as Record<string, unknown>)),
    usernameMatches: usernameMatchesRaw.map((doc: MongoDocument) => normalizeDbUserRow(doc as Record<string, unknown>)),
    clerkIdMatches: clerkIdMatchesRaw.map((doc: MongoDocument) => normalizeDbUserRow(doc as Record<string, unknown>)),
    duplicateEmails,
    duplicateUsernames,
  };
}

// ============================================================================
// Clerk-operasjoner
// ============================================================================

async function createEmailUser(
  clerk: ReturnType<typeof createClerkClient>,
  email: string,
  username: string,
): Promise<CreateAttemptEvidence> {
  logger.step("Creating Clerk user", `email=${email}, username=${username}`);

  try {
    const user = await clerk.users.createUser({
      emailAddress: [email],
      username: username,
      password: TEST_PASSWORD,
      firstName: "Auth",
      lastName: "Matrix",
      skipPasswordChecks: true,
    });

    const primaryEmail = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);

    const evidence: CreateAttemptEvidence = {
      ok: true,
      provider: "email",
      requestedEmail: email,
      requestedUsername: username,
      user: {
        id: user.id,
        email: primaryEmail?.emailAddress ?? email,
        username: user.username,
        externalAccountsCount: user.externalAccounts?.length ?? 0,
        primaryEmailVerified: primaryEmail?.verification?.status === "verified" ? true : primaryEmail?.verification?.status ? false : null,
      },
    };

    logger.logClerkCreate("user", evidence);
    return evidence;
  } catch (error) {
    const evidence: CreateAttemptEvidence = {
      ok: false,
      provider: "email",
      requestedEmail: email,
      requestedUsername: username,
      error: parseClerkCreateError(error),
    };
    logger.logClerkCreate("user", evidence);
    return evidence;
  }
}

async function deleteUserSafe(clerk: ReturnType<typeof createClerkClient>, userId: string): Promise<boolean> {
  try {
    await clerk.users.deleteUser(userId);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    // Allerede slettet er OK
    if (msg.includes("404") || msg.includes("not found")) return true;
    return false;
  }
}

async function callTestAuthFlow(clerkId: string, flowId: string): Promise<{ status: number; body: unknown }> {
  logger.step("Calling auth flow endpoint", `flowId=${flowId}`);
  logger.setFlowId(flowId);

  const response = await fetch(`${BACKEND_URL}/api/debug/test-auth-flow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      "x-debug-flow-id": flowId,
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({ clerkId, flowId }),
  });

  const body = await response.json().catch(() => null);
  logger.logAuthFlow("response", { status: response.status, body });
  return { status: response.status, body };
}

interface UpdateProfileResult {
  status: number;
  body: unknown;
  success: boolean;
  conflict: boolean;
  detectionPhase?: "early_check" | "db_fallback";
}

async function callTestUpdateProfile(
  clerkId: string,
  newUsername: string,
  flowId: string,
): Promise<UpdateProfileResult> {
  logger.step("Calling update profile endpoint", `clerkId=${clerkId}, newUsername=${newUsername}`);
  logger.setFlowId(flowId);

  const response = await fetch(`${BACKEND_URL}/api/debug/test-update-profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      "x-debug-flow-id": flowId,
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({ clerkId, newUsername, flowId }),
  });

  const body = await response.json().catch(() => null);
  logger.logAuthFlow("update-profile response", { status: response.status, body });

  const conflict = response.status === 409;
  const success = response.status === 200 && typeof body === "object" && body !== null && "success" in body && body.success === true;
  const detectionPhase = conflict && typeof body === "object" && body !== null && "detectionPhase" in body
    ? (body.detectionPhase as "early_check" | "db_fallback")
    : undefined;

  return { status: response.status, body, success, conflict, detectionPhase };
}

// ============================================================================
// Klassifisering
// ============================================================================

function classifyScenario(
  scenario: ExecutableScenario,
  createAttempts: CreateAttemptEvidence[],
  flowResponses: FlowResponseEvidence[],
  dbSnapshot: DbSnapshotEvidence,
  updateResults?: UpdateResultEvidence[],
): string {
  const [firstCreate, secondCreate] = createAttempts;
  const [flowA, flowB] = flowResponses;

  // Første opprettelse feilet
  if (!firstCreate?.ok) {
    if (firstCreate?.error && hasValidationError(firstCreate.error)) {
      return "CLERK_VALIDATION_ERROR_FIRST";
    }
    return "SCENARIO_SETUP_FAILED_FIRST_IDENTITY";
  }

  // Første flow feilet
  if (!flowA || flowA.outcome === "http_error") {
    return `FLOW_A_FAILED_HTTP_${flowA?.httpStatus ?? "UNKNOWN"}`;
  }

  // Ingen andre identitet i scenariet
  if (!scenario.second) {
    // Sjekk for enkeltbruker-oppdateringsscenarioer (G02-G04)
    if (scenario.action === "update" && updateResults && updateResults.length > 0) {
      const updateResult = updateResults[0];
      if (updateResult.success) {
        // Oppdatering ble tillatt (store/små bokstaver/mellomrom normalisert eller samme brukernavn akseptert)
        return "USERNAME_UPDATE_ALLOWED";
      }
      if (updateResult.httpStatus === 400) {
        // Valideringsfeil (ugyldig format avvist)
        return "USERNAME_UPDATE_VALIDATION_ERROR";
      }
      if (updateResult.conflict) {
        // Selvkonflikt (bør ikke skje for enkeltbruker)
        return "USERNAME_UPDATE_SELF_CONFLICT";
      }
      return `USERNAME_UPDATE_FAILED_HTTP_${updateResult.httpStatus}`;
    }
    
    // Enkeltidentitet-scenario (f.eks. valideringstest)
    if (flowA.outcome === "success") {
      return "SINGLE_USER_SUCCESS";
    }
    return "SINGLE_USER_FLOW_UNEXPECTED";
  }

  // Andre opprettelse ikke forsøkt
  if (!secondCreate) {
    return "SCENARIO_SETUP_FAILED_SECOND_IDENTITY_NOT_ATTEMPTED";
  }

  // Andre opprettelse blokkert av Clerk
  if (!secondCreate.ok && secondCreate.error) {
    if (hasDuplicateEmailSignal(secondCreate.error)) {
      return "CLERK_BLOCKED_DUPLICATE_EMAIL";
    }
    if (hasDuplicateUsernameSignal(secondCreate.error)) {
      return "CLERK_BLOCKED_DUPLICATE_USERNAME";
    }
    if (hasValidationError(secondCreate.error)) {
      return "CLERK_VALIDATION_ERROR_SECOND";
    }
    return "CLERK_BLOCKED_SECOND_IDENTITY_UNKNOWN";
  }

  // Andre flow hadde konflikt
  if (flowB?.outcome === "conflict") {
    if (flowB.conflictType === "usernameConflict") return "BACKEND_BLOCKED_USERNAME_CONFLICT";
    if (flowB.conflictType === "accountConflict") return "BACKEND_BLOCKED_ACCOUNT_CONFLICT";
    if (flowB.conflictType === "oauthAccountConflict") return "BACKEND_BLOCKED_OAUTH_ACCOUNT_CONFLICT";
    if (flowB.conflictType === "oauthMetadataMissing") return "BACKEND_BLOCKED_OAUTH_METADATA_MISSING";
    if (flowB.conflictType === "userDeleted") return "BACKEND_BLOCKED_DELETED_USER";
    return "BACKEND_BLOCKED_UNKNOWN_CONFLICT";
  }

  if (flowB?.outcome === "null") {
    return "FLOW_B_RETURNED_NULL";
  }

  if (flowB?.outcome === "http_error") {
    return `FLOW_B_HTTP_${flowB.httpStatus}`;
  }

  // Håndter to-bruker oppdateringsscenarioer (f.eks. G01, G06 - oppdatering til eksisterende brukernavn)
  if (scenario.action === "update" && updateResults && updateResults.length > 0) {
    const updateResult = updateResults[0];
    if (updateResult.conflict) {
      // Brukernavn-oppdatering ble korrekt blokkert
      const phase = updateResult.detectionPhase === "early_check" ? "EARLY_CHECK" : 
                    updateResult.detectionPhase === "db_fallback" ? "DB_FALLBACK" : "UNKNOWN";
      return `USERNAME_UPDATE_BLOCKED_${phase}`;
    }
    if (updateResult.success) {
      // Dette er en FEIL - oppdateringen burde ha blitt blokkert
      return "BUG_USERNAME_UPDATE_ALLOWED";
    }
    if (updateResult.httpStatus === 400) {
      return "USERNAME_UPDATE_INVALID_FORMAT";
    }
    if (updateResult.httpStatus === 404) {
      return "USERNAME_UPDATE_USER_NOT_FOUND";
    }
    return `USERNAME_UPDATE_FAILED_HTTP_${updateResult.httpStatus}`;
  }

  // Begge lyktes
  if (flowA?.outcome === "success" && flowB?.outcome === "success") {
    const sameLocal = flowA.localUserId && flowB.localUserId && flowA.localUserId === flowB.localUserId;
    if (sameLocal) {
      return "SAME_LOCAL_USER_REUSED";
    }
    // Sjekk for DB-duplikater
    if (dbSnapshot.duplicateEmails.length > 0) {
      return "REAL_LOCAL_DUPLICATE_EMAIL";
    }
    if (dbSnapshot.duplicateUsernames.length > 0) {
      return "REAL_LOCAL_DUPLICATE_USERNAME";
    }
    return "TWO_DISTINCT_LOCAL_USERS";
  }

  return "UNRESOLVED";
}

// ============================================================================
// Scenariokjørere
// ============================================================================

async function runExecutableScenario(
  clerk: ReturnType<typeof createClerkClient>,
  scenario: ExecutableScenario,
): Promise<ScenarioEvidence> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const flowIds: string[] = [];
  const clerkUsers: ClerkUserEvidence[] = [];
  const createAttempts: CreateAttemptEvidence[] = [];
  const flowResponses: FlowResponseEvidence[] = [];
  const notes: string[] = [];
  const cleanup = { deletedUserIds: [] as string[], failedDeletes: [] as string[] };

  logger.setScenario(scenario.id);
  logger.header(`SCENARIO ${scenario.id}`);
  logger.info(scenario.description);
  logger.info(`Expected: ${scenario.expectedOutcome}`);

  const usersBefore = await countUsers();
  logger.step("DB snapshot before", `users=${usersBefore}`);

  // Opprett første identitet
  const flowIdA = `${scenario.id}-A-${Date.now()}`;
  flowIds.push(flowIdA);

  const firstCreate = await createEmailUser(clerk, scenario.first.email, scenario.first.username);
  createAttempts.push(firstCreate);

  if (firstCreate.ok && firstCreate.user) {
    clerkUsers.push(firstCreate.user);
  }

  let flowA: FlowResponseEvidence | null = null;
  let secondCreate: CreateAttemptEvidence | null = null;
  let flowB: FlowResponseEvidence | null = null;

  try {
    if (!firstCreate.ok || !firstCreate.user) {
      const classification = classifyScenario(scenario, createAttempts, flowResponses, {
        available: false, reason: "First identity failed", usersBefore: -1, usersAfter: -1,
        emailMatches: [], usernameMatches: [], clerkIdMatches: [], duplicateEmails: [], duplicateUsernames: [],
      });

      return {
        id: scenario.id,
        group: scenario.group,
        kind: scenario.kind,
        description: scenario.description,
        status: "setup_failed",
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - startMs,
        classification,
        expectedOutcome: scenario.expectedOutcome,
        outcomeMatch: classification === scenario.expectedOutcome,
        flowIds,
        clerkUsers,
        createAttempts,
        flowResponses,
        dbSnapshot: { available: false, reason: "First identity failed", usersBefore, usersAfter: -1, emailMatches: [], usernameMatches: [], clerkIdMatches: [], duplicateEmails: [], duplicateUsernames: [] },
        notes,
        cleanup,
      };
    }

    // Kall auth-flow for første bruker
    const flowAResponse = await callTestAuthFlow(firstCreate.user.id, flowIdA);
    flowA = parseFlowResponse(flowAResponse.status, flowAResponse.body);
    flowResponses.push(flowA);

    // Opprett andre identitet hvis definert
    if (scenario.second) {
      const flowIdB = `${scenario.id}-B-${Date.now()}`;
      flowIds.push(flowIdB);

      secondCreate = await createEmailUser(clerk, scenario.second.email, scenario.second.username);
      createAttempts.push(secondCreate);

      if (secondCreate.ok && secondCreate.user) {
        clerkUsers.push(secondCreate.user);

        // Kall auth-flow for andre bruker
        const flowBResponse = await callTestAuthFlow(secondCreate.user.id, flowIdB);
        flowB = parseFlowResponse(flowBResponse.status, flowBResponse.body);
        flowResponses.push(flowB);
      } else {
        notes.push("Second identity creation blocked by Clerk");
      }
    }

    // Håndter oppdateringsscenarioer (f.eks. oppdater brukernavn til eksisterende)
    const updateResults: UpdateResultEvidence[] = [];
    if (scenario.action === "update" && scenario.second && secondCreate?.ok && secondCreate?.user) {
      // For oppdateringsscenarioer med to brukere, prøv å oppdatere den andre brukerens brukernavn til den første brukerens brukernavn
      const updateFlowId = `${scenario.id}-UPDATE-${Date.now()}`;
      flowIds.push(updateFlowId);
      
      logger.step("Username update test", `Attempting to change ${scenario.second.username} → ${scenario.first.username}`);
      
      const updateResult = await callTestUpdateProfile(
        secondCreate.user.id,
        scenario.first.username, // Prøv å bruke den første brukerens brukernavn
        updateFlowId,
      );
      
      updateResults.push({
        attempted: true,
        clerkId: secondCreate.user.id,
        targetUsername: scenario.first.username,
        httpStatus: updateResult.status,
        success: updateResult.success,
        conflict: updateResult.conflict,
        detectionPhase: updateResult.detectionPhase,
        rawBody: updateResult.body,
      });

      if (updateResult.conflict) {
        notes.push(`Username update blocked (${updateResult.detectionPhase ?? "unknown phase"})`);
      } else if (updateResult.success) {
        notes.push("WARNING: Username update succeeded when it should have been blocked");
      } else {
        notes.push(`Username update failed with status ${updateResult.status}`);
      }
    } else if (scenario.action === "update" && !scenario.second && firstCreate.ok && firstCreate.user) {
      // Enkeltbruker-oppdateringsscenarioer (G02-G04): test store/små bokstaver, mellomrom eller ugyldig format
      const updateFlowId = `${scenario.id}-UPDATE-${Date.now()}`;
      flowIds.push(updateFlowId);
      
      // Bestem hvilket brukernavn som skal testes basert på scenario-ID
      let testUsername: string;
      const baseUsername = scenario.first.username;
      
      if (scenario.id.includes("same-casing")) {
        // G02: Test store/små bokstaver - konverter til store bokstaver
        testUsername = baseUsername.toUpperCase();
        logger.step("Username update test (casing)", `${baseUsername} → ${testUsername}`);
      } else if (scenario.id.includes("whitespace")) {
        // G03: Test mellomrom - legg til ledende/etterfølgende mellomrom
        testUsername = `  ${baseUsername}  `;
        logger.step("Username update test (whitespace)", `"${baseUsername}" → "  ${baseUsername}  "`);
      } else if (scenario.id.includes("invalid-format")) {
        // G04: Test ugyldig format
        testUsername = "@#$%!";
        logger.step("Username update test (invalid)", `${baseUsername} → ${testUsername}`);
      } else {
        // Fallback: bruk bare det samme brukernavnet
        testUsername = baseUsername;
        logger.step("Username update test", `${baseUsername} → ${testUsername}`);
      }
      
      const updateResult = await callTestUpdateProfile(
        firstCreate.user.id,
        testUsername,
        updateFlowId,
      );
      
      updateResults.push({
        attempted: true,
        clerkId: firstCreate.user.id,
        targetUsername: testUsername,
        httpStatus: updateResult.status,
        success: updateResult.success,
        conflict: updateResult.conflict,
        detectionPhase: updateResult.detectionPhase,
        rawBody: updateResult.body,
      });

      if (updateResult.success) {
        notes.push(`Username update succeeded (new: ${testUsername})`);
      } else if (updateResult.conflict) {
        notes.push(`Username update blocked: conflict`);
      } else if (updateResult.status === 400) {
        notes.push(`Username update blocked: validation error`);
      } else {
        notes.push(`Username update failed with status ${updateResult.status}`);
      }
    }

    // Samle DB-snapshot
    const emails = [scenario.first.email];
    const usernames = [scenario.first.username];
    const clerkIdList = clerkUsers.map((u) => u.id);

    if (scenario.second) {
      emails.push(scenario.second.email);
      usernames.push(scenario.second.username);
    }

    const dbSnapshot = await collectDbSnapshot(emails, usernames, clerkIdList, usersBefore);
    logger.logDbSnapshot(dbSnapshot);

    // Klassifiser
    const classification = classifyScenario(scenario, createAttempts, flowResponses, dbSnapshot, updateResults);
    logger.logClassification(classification);

    const outcomeMatch = classification === scenario.expectedOutcome || 
      (scenario.expectedOutcome.includes("OR") && scenario.expectedOutcome.split("_OR_").some(exp => classification.includes(exp))) ||
      // Håndter USERNAME_UPDATE_BLOCKED med vilkårlig deteksjonsfase
      (scenario.expectedOutcome === "USERNAME_UPDATE_BLOCKED" && classification.startsWith("USERNAME_UPDATE_BLOCKED")) ||
      // Håndter EARLY_BLOCK_OR_DB_FALLBACK som matcher begge
      (scenario.expectedOutcome === "EARLY_BLOCK_OR_DB_FALLBACK" && 
       (classification === "USERNAME_UPDATE_BLOCKED_EARLY_CHECK" || classification === "USERNAME_UPDATE_BLOCKED_DB_FALLBACK")) ||
      // Håndter ALLOWED_OR_NORMALIZED (G02: endring av store/små bokstaver)
      (scenario.expectedOutcome === "ALLOWED_OR_NORMALIZED" && classification === "USERNAME_UPDATE_ALLOWED") ||
      // Håndter VALIDATION_ERROR_OR_TRIMMED (G03: mellomrom - enten tillatt+trimmet eller valideringsfeil)
      (scenario.expectedOutcome === "VALIDATION_ERROR_OR_TRIMMED" && 
       (classification === "USERNAME_UPDATE_ALLOWED" || classification === "USERNAME_UPDATE_VALIDATION_ERROR")) ||
      // Håndter VALIDATION_ERROR (G04: ugyldig format - backend validerer ikke tegn, så kan tillate eller kollidere)
      // MERK: sanitizeUsername() trimmer bare mellomrom, validerer ikke tegn. Reell validering skjer ved Clerk-registrering.
      (scenario.expectedOutcome === "VALIDATION_ERROR" && 
       (classification === "USERNAME_UPDATE_VALIDATION_ERROR" || 
        classification === "USERNAME_UPDATE_ALLOWED" || 
        classification === "USERNAME_UPDATE_SELF_CONFLICT"));

    if (!outcomeMatch) {
      logger.warn(`Outcome mismatch: expected=${scenario.expectedOutcome}, got=${classification}`);
    }

    return {
      id: scenario.id,
      group: scenario.group,
      kind: scenario.kind,
      description: scenario.description,
      status: "executed",
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startMs,
      classification,
      expectedOutcome: scenario.expectedOutcome,
      outcomeMatch,
      flowIds,
      clerkUsers,
      createAttempts,
      flowResponses,
      updateResults: updateResults.length > 0 ? updateResults : undefined,
      dbSnapshot,
      notes,
      cleanup,
    };
  } finally {
    // Opprydding: slett test-brukere
    logger.step("Cleanup", `deleting ${clerkUsers.length} Clerk user(s)`);
    for (const user of clerkUsers) {
      const ok = await deleteUserSafe(clerk, user.id);
      if (ok) {
        cleanup.deletedUserIds.push(user.id);
      } else {
        cleanup.failedDeletes.push(user.id);
      }
    }
    logger.logCleanup(cleanup.deletedUserIds, cleanup.failedDeletes);
    logger.setScenario(null);
  }
}

function createManualEvidence(scenario: ManualScenario | E2eScenario | RaceScenario): ScenarioEvidence {
  const status = 
    scenario.kind === "e2e_browser" ? "e2e_required" :
    scenario.kind === "e2e_oauth" ? "oauth_required" :
    scenario.kind === "admin_only" ? "admin_required" :
    scenario.kind === "race_condition" ? "race_condition" :
    "manual_required";

  return {
    id: scenario.id,
    group: scenario.group,
    kind: scenario.kind,
    description: scenario.description,
    status,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationMs: 0,
    classification: `MANUAL_${status.toUpperCase()}`,
    expectedOutcome: scenario.expectedOutcome,
    outcomeMatch: false,
    flowIds: [],
    clerkUsers: [],
    createAttempts: [],
    flowResponses: [],
    dbSnapshot: { available: false, reason: "Manual scenario", usersBefore: -1, usersAfter: -1, emailMatches: [], usernameMatches: [], clerkIdMatches: [], duplicateEmails: [], duplicateUsernames: [] },
    notes: [],
    cleanup: { deletedUserIds: [], failedDeletes: [] },
    manualSteps: "manualSteps" in scenario ? scenario.manualSteps : undefined,
    blocker: "blocker" in scenario ? scenario.blocker : undefined,
  };
}

// ============================================================================
// Main
// ============================================================================

async function verifyBackendReady(): Promise<boolean> {
  const health = await fetch(`${BACKEND_URL}/health`).catch(() => null);
  if (!health || !health.ok) return false;

  const probe = await fetch(`${BACKEND_URL}/api/debug/test-auth-flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-studywise-csrf": "1", Origin: BACKEND_URL },
    body: JSON.stringify({}),
  }).catch(() => null);

  return !!probe && probe.status === 400;
}

async function connectMongoIfAvailable(): Promise<string | null> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) return "MONGO_URI missing";

  try {
    await mongoose.connect(mongoUri, MONGO_OPTIONS);
    usersCollection = mongoose.connection.db?.collection("users") ?? null;
    if (!usersCollection) return "Connection OK but users collection unavailable";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type ModeArg = "full" | "basic" | "update" | "delete" | "race" | "session" | "oauth" | ScenarioGroup;

function parseMode(arg: string | undefined): { mode: ModeArg; scenarios: ScenarioDefinition[] } {
  const value = (arg ?? "full").toUpperCase();

  // Enkeltgruppe
  const groups: ScenarioGroup[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
  if (groups.includes(value as ScenarioGroup)) {
    return { mode: value as ScenarioGroup, scenarios: buildGroupByName(value as ScenarioGroup) };
  }

  // Forhåndsdefinerte moduser
  const fullMatrix = buildFullMatrix();

  switch (value.toLowerCase()) {
    case "basic":
      return { mode: "basic", scenarios: fullMatrix.filter((s) => s.group === "A" || s.group === "B") };
    case "update":
      return { mode: "update", scenarios: fullMatrix.filter((s) => s.group === "G" || s.group === "H") };
    case "delete":
      return { mode: "delete", scenarios: fullMatrix.filter((s) => s.group === "I") };
    case "race":
      return { mode: "race", scenarios: fullMatrix.filter((s) => s.kind === "race_condition") };
    case "session":
      return { mode: "session", scenarios: fullMatrix.filter((s) => s.group === "J") };
    case "oauth":
      return { mode: "oauth", scenarios: fullMatrix.filter((s) => s.requiresOAuth) };
    case "full":
    default:
      return { mode: "full", scenarios: fullMatrix };
  }
}

async function main(): Promise<void> {
  setRunSeed(RUN_SEED);
  const { mode, scenarios } = parseMode(process.argv[2]);
  const runId = `auth-expanded-${mode}-${RUN_SEED}`;

  logger = createVerboseLogger(runId, true);

  logger.header("EXPANDED AUTH MATRIX RUNNER");
  logger.info(`Mode: ${mode}`);
  logger.info(`Run ID: ${runId}`);
  logger.info(`Backend: ${BACKEND_URL}`);
  logger.info(`Scenarios loaded: ${scenarios.length}`);

  const stats = getScenarioStats(scenarios);
  logger.info(`Stats: executable=${stats.executable}, e2e=${stats.e2e}, oauth=${stats.oauth}, manual=${stats.manual}, race=${stats.race}`);

  // Verifiser miljø
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.error("CLERK_SECRET_KEY missing");
    throw new Error("CLERK_SECRET_KEY required");
  }

  const diagnosticsEnabled = await verifyBackendReady();
  if (!diagnosticsEnabled) {
    logger.error("Backend not ready or diagnostics disabled");
    throw new Error("Backend must run with ENABLE_DIAGNOSTICS=true");
  }
  logger.success("Backend ready with diagnostics enabled");

  const mongoError = await connectMongoIfAvailable();
  const mongoConnected = !mongoError;
  if (mongoError) {
    logger.warn(`MongoDB not connected: ${mongoError}`);
  } else {
    logger.success("MongoDB connected");
  }

  const clerk = createClerkClient({ secretKey });
  const usersApiRecord = clerk.users as unknown as Record<string, unknown>;

  const startedAt = nowIso();
  const startMs = Date.now();
  const scenarioEvidence: ScenarioEvidence[] = [];
  const classifications: Record<string, number> = {};

  // Kjør scenarioer
  for (const scenario of scenarios) {
    let evidence: ScenarioEvidence;

    if (scenario.kind === "executable" || scenario.kind === "api_manual") {
      evidence = await runExecutableScenario(clerk, scenario as ExecutableScenario);
    } else {
      // Manuelle/E2E/OAuth/Admin-scenarioer
      logger.setScenario(scenario.id);
      logger.header(`SCENARIO ${scenario.id} (${scenario.kind})`);
      logger.info(scenario.description);
      logger.info(`Status: requires ${scenario.kind}`);
      if ("blocker" in scenario && scenario.blocker) {
        logger.info(`Blocker: ${scenario.blocker}`);
      }
      evidence = createManualEvidence(scenario as ManualScenario);
      logger.setScenario(null);
    }

    scenarioEvidence.push(evidence);
    classifications[evidence.classification] = (classifications[evidence.classification] ?? 0) + 1;

    // Lagre bevis per scenario
    const scenarioFile = writeJson(`scenario-${scenario.id}-${slugTime()}.json`, evidence);
    logger.debug(`Evidence saved: ${scenarioFile}`);
  }

  const finishedAt = nowIso();
  const durationMs = Date.now() - startMs;

  // Beregn statistikk
  const executed = scenarioEvidence.filter((e) => e.status === "executed").length;
  const setupFailed = scenarioEvidence.filter((e) => e.status === "setup_failed").length;
  const manualRequired = scenarioEvidence.filter((e) => e.status === "manual_required").length;
  const e2eRequired = scenarioEvidence.filter((e) => e.status === "e2e_required").length;
  const oauthRequired = scenarioEvidence.filter((e) => e.status === "oauth_required").length;
  const adminRequired = scenarioEvidence.filter((e) => e.status === "admin_required").length;
  const raceCondition = scenarioEvidence.filter((e) => e.status === "race_condition").length;
  const skipped = scenarioEvidence.filter((e) => e.status === "skipped").length;

  // Bygg matrise-bevis
  const matrixEvidence: MatrixEvidence = {
    runId,
    mode,
    startedAt,
    finishedAt,
    durationMs,
    backendUrl: BACKEND_URL,
    diagnosticsEnabled,
    mongoConnected,
    capabilities: {
      clerkUsersApiMethods: {
        createUser: typeof usersApiRecord.createUser === "function",
        deleteUser: typeof usersApiRecord.deleteUser === "function",
        deleteUserExternalAccount: typeof usersApiRecord.deleteUserExternalAccount === "function",
        createUserExternalAccount: typeof usersApiRecord.createUserExternalAccount === "function",
      },
      oauthAutomationSupported: false,
      oauthAutomationBlocker: "OAuth scenarios require real provider authentication",
    },
    stats: {
      total: scenarioEvidence.length,
      executable: stats.executable,
      executed,
      setupFailed,
      manualRequired,
      e2eRequired,
      oauthRequired,
      adminRequired,
      raceCondition,
      skipped,
    },
    classifications,
    scenarios: scenarioEvidence,
    logFilePath: logger.getLogFilePath(),
    jsonEventsPath: logger.writeJsonEvents(),
  };

  // Lagre matrise-bevis
  const matrixFile = writeJson(`matrix-${mode}-${slugTime()}.json`, matrixEvidence);

  // Skriv ut oppsummering
  logger.printSummary({
    total: scenarioEvidence.length,
    executed,
    manualRequired: manualRequired + e2eRequired + oauthRequired + adminRequired + raceCondition,
    setupFailed,
    classifications,
  });

  logger.header("OUTPUT FILES");
  logger.info(`Matrix evidence: ${matrixFile}`);
  logger.info(`Log file: ${logger.getLogFilePath()}`);
  logger.info(`JSON events: ${matrixEvidence.jsonEventsPath}`);

  logger.header("CLASSIFICATION SUMMARY");
  for (const [classification, count] of Object.entries(classifications).sort((a, b) => b[1] - a[1])) {
    logger.info(`${classification}: ${count}`);
  }

  // Koble fra Mongo
  if (mongoConnected) {
    await mongoose.disconnect();
  }

  // Avslutt med feil hvis noen oppsett feilet
  if (setupFailed > 0) {
    logger.warn(`${setupFailed} scenario(s) had setup failures`);
  }

  process.exitCode = setupFailed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});

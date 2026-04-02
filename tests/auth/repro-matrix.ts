#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Auth Identity Matrix Runner
 *
 * Produces machine-readable evidence for duplicate identity scenarios:
 * - Executable scenarios (email/password via Clerk Backend API + /api/debug/test-auth-flow)
 * - Manual-required scenarios (cross-provider OAuth flows)
 *
 * Usage:
 *   pnpm --filter tests exec tsx auth/repro-matrix.ts email
 *   pnpm --filter tests exec tsx auth/repro-matrix.ts google-email
 *   pnpm --filter tests exec tsx auth/repro-matrix.ts email-google
 *   pnpm --filter tests exec tsx auth/repro-matrix.ts full
 */

import "../helpers/env.js";
import { BACKEND_URL } from "../helpers/env.js";
import { createClerkClient } from "@clerk/backend";
import mongoose, { type ConnectOptions } from "mongoose";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { header, log } from "../helpers/log.js";

type Provider = "email" | "google" | "microsoft";
type ScenarioKind = "executable" | "manual";
type ScenarioStatus =
  | "executed"
  | "manual_required"
  | "setup_failed"
  | "skipped";

type ModeArg =
  | "email"
  | "google-email"
  | "email-google"
  | "microsoft-email"
  | "email-microsoft"
  | "full";

interface IdentitySpec {
  provider: Provider;
  email: string;
  username: string;
}

interface ExecutableScenario {
  kind: "executable";
  id: string;
  group: string;
  description: string;
  first: IdentitySpec;
  second: IdentitySpec;
}

interface ManualScenario {
  kind: "manual";
  id: string;
  group: string;
  description: string;
  blocker: string;
  manualSteps: string[];
}

type ScenarioDefinition = ExecutableScenario | ManualScenario;

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
  provider: Provider;
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
  authProvider?: string;
  deletedAt?: string;
  oauthAccountsCount: number;
}

interface DbSnapshotEvidence {
  available: boolean;
  reason?: string;
  emailMatches: DbUserRow[];
  usernameMatches: DbUserRow[];
  clerkIdMatches: DbUserRow[];
}

interface ScenarioEvidenceBase {
  id: string;
  kind: ScenarioKind;
  group: string;
  description: string;
  status: ScenarioStatus;
  startedAt: string;
  finishedAt: string;
  classification: string;
}

interface ExecutedScenarioEvidence extends ScenarioEvidenceBase {
  kind: "executable";
  first: IdentitySpec;
  second: IdentitySpec;
  flowIdA: string;
  flowIdB: string;
  firstCreate: CreateAttemptEvidence;
  secondCreate: CreateAttemptEvidence | null;
  flowA: FlowResponseEvidence | null;
  flowB: FlowResponseEvidence | null;
  dbSnapshot: DbSnapshotEvidence;
  notes: string[];
  cleanup: {
    deletedUserIds: string[];
    failedDeletes: string[];
  };
}

interface ManualScenarioEvidence extends ScenarioEvidenceBase {
  kind: "manual";
  blocker: string;
  manualSteps: string[];
}

type ScenarioEvidence = ExecutedScenarioEvidence | ManualScenarioEvidence;

interface MatrixEvidence {
  runId: string;
  mode: ModeArg;
  startedAt: string;
  finishedAt: string;
  backendUrl: string;
  diagnosticsEndpointEnabled: boolean;
  capabilities: {
    clerkUsersApiMethods: {
      createUser: boolean;
      deleteUser: boolean;
      deleteUserExternalAccount: boolean;
      createUserExternalAccount: boolean;
    };
    oauthAutomationSupported: boolean;
    oauthAutomationBlocker: string;
  };
  scenarios: ScenarioEvidence[];
  totals: {
    total: number;
    executed: number;
    manualRequired: number;
    setupFailed: number;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const RUN_SEED = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_PASSWORD = process.env.TEST_CLERK_PASSWORD ?? "ReproMatrix123!";

const MONGO_OPTIONS: ConnectOptions = {
  serverApi: {
    version: "1",
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 10_000,
};

type UsersCollection = ReturnType<
  NonNullable<typeof mongoose.connection.db>["collection"]
>;

let usersCollection: UsersCollection | null = null;

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

function makeEmail(label: string): string {
  return `auth-matrix-${label}-${RUN_SEED}@example.com`;
}

function makeUsername(label: string): string {
  return `mx_${label}_${RUN_SEED}`.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().slice(0, 30);
}

function parseModeArg(rawArg: string | undefined): ModeArg {
  const value = (rawArg ?? "full").toLowerCase();
  const allowed: ModeArg[] = [
    "email",
    "google-email",
    "email-google",
    "microsoft-email",
    "email-microsoft",
    "full",
  ];
  if (allowed.includes(value as ModeArg)) {
    return value as ModeArg;
  }
  throw new Error(
    `Unknown mode "${value}". Allowed: ${allowed.join(", ")}`,
  );
}

function parseClerkCreateError(error: unknown): ClerkCreateErrorInfo {
  const message = error instanceof Error ? error.message : String(error);
  const asObject = error as {
    status?: number;
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
  };
  const status =
    typeof asObject.status === "number" ? asObject.status : undefined;
  const errors = Array.isArray(asObject.errors) ? asObject.errors : [];

  return {
    message,
    status,
    codes: errors
      .map((item) => item.code)
      .filter((code): code is string => typeof code === "string"),
    longMessages: errors
      .map((item) => item.longMessage ?? item.message)
      .filter((text): text is string => typeof text === "string"),
  };
}

function hasDuplicateEmailSignal(error: ClerkCreateErrorInfo): boolean {
  const blob = [error.message, ...error.codes, ...error.longMessages]
    .join(" ")
    .toLowerCase();
  return blob.includes("email") && (blob.includes("exist") || blob.includes("taken") || blob.includes("already"));
}

function hasDuplicateUsernameSignal(error: ClerkCreateErrorInfo): boolean {
  const blob = [error.message, ...error.codes, ...error.longMessages]
    .join(" ")
    .toLowerCase();
  return blob.includes("username") && (blob.includes("exist") || blob.includes("taken") || blob.includes("already"));
}

function detectConflictType(result: unknown): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
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
    typeof body === "object" &&
    body !== null &&
    typeof (body as { classification?: unknown }).classification === "string"
      ? (body as { classification: string }).classification
      : null;
  const result =
    typeof body === "object" && body !== null
      ? (body as { result?: unknown }).result
      : null;

  if (rawClassification?.startsWith("success") && typeof result === "object" && result !== null && "_id" in result) {
    const user = result as {
      _id?: unknown;
      email?: unknown;
      username?: unknown;
    };
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

function scenarioClassificationFromEvidence(
  evidence: ExecutedScenarioEvidence,
): string {
  if (!evidence.firstCreate.ok) {
    return "SCENARIO_SETUP_FAILED_FIRST_IDENTITY";
  }

  if (!evidence.flowA || evidence.flowA.outcome === "http_error") {
    return "FLOW_A_FAILED";
  }

  if (!evidence.secondCreate) {
    return "SCENARIO_SETUP_FAILED_SECOND_IDENTITY_NOT_ATTEMPTED";
  }

  if (!evidence.secondCreate.ok && evidence.secondCreate.error) {
    if (hasDuplicateEmailSignal(evidence.secondCreate.error)) {
      return "CLERK_BLOCKED_DUPLICATE_EMAIL";
    }
    if (hasDuplicateUsernameSignal(evidence.secondCreate.error)) {
      return "CLERK_BLOCKED_DUPLICATE_USERNAME";
    }
    return "CLERK_BLOCKED_SECOND_IDENTITY_UNKNOWN_REASON";
  }

  if (evidence.flowB?.outcome === "conflict") {
    if (evidence.flowB.conflictType === "usernameConflict") {
      return "BACKEND_BLOCKED_USERNAME_CONFLICT";
    }
    if (evidence.flowB.conflictType === "accountConflict") {
      return "BACKEND_BLOCKED_ACCOUNT_CONFLICT";
    }
    if (evidence.flowB.conflictType === "oauthAccountConflict") {
      return "BACKEND_BLOCKED_OAUTH_ACCOUNT_CONFLICT";
    }
    if (evidence.flowB.conflictType === "oauthMetadataMissing") {
      return "BACKEND_BLOCKED_OAUTH_METADATA_MISSING";
    }
    if (evidence.flowB.conflictType === "userDeleted") {
      return "BACKEND_BLOCKED_DELETED_USER";
    }
    return "BACKEND_BLOCKED_UNKNOWN_CONFLICT";
  }

  if (evidence.flowB?.outcome === "null") {
    return "FLOW_B_RETURNED_NULL";
  }

  if (evidence.flowB?.outcome === "http_error") {
    return `FLOW_B_HTTP_${evidence.flowB.httpStatus}`;
  }

  if (evidence.flowA?.outcome === "success" && evidence.flowB?.outcome === "success") {
    const sameLocal =
      evidence.flowA.localUserId !== null &&
      evidence.flowB.localUserId !== null &&
      evidence.flowA.localUserId === evidence.flowB.localUserId;

    if (sameLocal) {
      return "SAME_LOCAL_USER_REUSED";
    }
    return "TWO_DISTINCT_LOCAL_USERS";
  }

  return "UNRESOLVED";
}

function normalizeDbUserRow(doc: Record<string, unknown>): DbUserRow {
  return {
    _id: String(doc._id ?? ""),
    email: typeof doc.email === "string" ? doc.email : undefined,
    username: typeof doc.username === "string" ? doc.username : undefined,
    usernameNormalized:
      typeof doc.usernameNormalized === "string"
        ? doc.usernameNormalized
        : undefined,
    clerkId: typeof doc.clerkId === "string" ? doc.clerkId : undefined,
    authProvider:
      typeof doc.authProvider === "string" ? doc.authProvider : undefined,
    deletedAt:
      doc.deletedAt instanceof Date
        ? doc.deletedAt.toISOString()
        : undefined,
    oauthAccountsCount: Array.isArray(doc.oauthAccounts)
      ? doc.oauthAccounts.length
      : 0,
  };
}

async function collectDbSnapshot(
  scenario: ExecutableScenario,
  createdClerkIds: string[],
): Promise<DbSnapshotEvidence> {
  if (!usersCollection) {
    return {
      available: false,
      reason: "MongoDB connection not available (MONGO_URI missing or connect failed)",
      emailMatches: [],
      usernameMatches: [],
      clerkIdMatches: [],
    };
  }

  const emails = [scenario.first.email, scenario.second.email];
  const usernameNormalized = [
    scenario.first.username.toLowerCase().trim(),
    scenario.second.username.toLowerCase().trim(),
  ];

  const projection = {
    _id: 1,
    email: 1,
    username: 1,
    usernameNormalized: 1,
    clerkId: 1,
    authProvider: 1,
    deletedAt: 1,
    oauthAccounts: 1,
  };

  const emailMatchesRaw = await usersCollection
    .find({ email: { $in: emails } }, { projection })
    .toArray();
  const usernameMatchesRaw = await usersCollection
    .find({ usernameNormalized: { $in: usernameNormalized } }, { projection })
    .toArray();
  const clerkIdMatchesRaw = createdClerkIds.length
    ? await usersCollection
        .find({ clerkId: { $in: createdClerkIds } }, { projection })
        .toArray()
    : [];

  return {
    available: true,
    emailMatches: emailMatchesRaw.map((doc) =>
      normalizeDbUserRow(doc as Record<string, unknown>),
    ),
    usernameMatches: usernameMatchesRaw.map((doc) =>
      normalizeDbUserRow(doc as Record<string, unknown>),
    ),
    clerkIdMatches: clerkIdMatchesRaw.map((doc) =>
      normalizeDbUserRow(doc as Record<string, unknown>),
    ),
  };
}

async function callTestAuthFlow(
  clerkId: string,
  flowId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BACKEND_URL}/api/debug/test-auth-flow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({ clerkId, flowId }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function createEmailUser(
  clerk: ReturnType<typeof createClerkClient>,
  identity: IdentitySpec,
): Promise<CreateAttemptEvidence> {
  if (identity.provider !== "email") {
    return {
      ok: false,
      provider: identity.provider,
      requestedEmail: identity.email,
      requestedUsername: identity.username,
      error: {
        message:
          "Only email/password users are executable in this automated runner",
        codes: ["unsupported_provider"],
        longMessages: [],
      },
    };
  }

  try {
    const user = await clerk.users.createUser({
      emailAddress: [identity.email],
      username: identity.username,
      password: TEST_PASSWORD,
      firstName: "Auth",
      lastName: "Matrix",
      skipPasswordChecks: true,
    });

    const primaryEmail = user.emailAddresses.find(
      (entry) => entry.id === user.primaryEmailAddressId,
    );

    return {
      ok: true,
      provider: identity.provider,
      requestedEmail: identity.email,
      requestedUsername: identity.username,
      user: {
        id: user.id,
        email: primaryEmail?.emailAddress ?? identity.email,
        username: user.username,
        externalAccountsCount: user.externalAccounts?.length ?? 0,
        primaryEmailVerified:
          primaryEmail?.verification?.status === "verified"
            ? true
            : primaryEmail?.verification?.status
              ? false
              : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      provider: identity.provider,
      requestedEmail: identity.email,
      requestedUsername: identity.username,
      error: parseClerkCreateError(error),
    };
  }
}

async function deleteUserSafe(
  clerk: ReturnType<typeof createClerkClient>,
  userId: string,
): Promise<boolean> {
  try {
    await clerk.users.deleteUser(userId);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes("404") || msg.includes("not found")) {
      return true;
    }
    return false;
  }
}

async function runExecutableScenario(
  clerk: ReturnType<typeof createClerkClient>,
  scenario: ExecutableScenario,
): Promise<ExecutedScenarioEvidence> {
  const startedAt = nowIso();
  const flowIdA = `${scenario.id}-A-${Date.now()}`;
  const flowIdB = `${scenario.id}-B-${Date.now()}`;
  const notes: string[] = [];
  const cleanupDeleted: string[] = [];
  const cleanupFailed: string[] = [];
  let flowA: FlowResponseEvidence | null = null;
  let flowB: FlowResponseEvidence | null = null;
  let secondCreate: CreateAttemptEvidence | null = null;

  const firstCreate = await createEmailUser(clerk, scenario.first);

  try {
    if (!firstCreate.ok || !firstCreate.user) {
      const finishedAt = nowIso();
      return {
        id: scenario.id,
        kind: "executable",
        group: scenario.group,
        description: scenario.description,
        status: "setup_failed",
        startedAt,
        finishedAt,
        classification: "SCENARIO_SETUP_FAILED_FIRST_IDENTITY",
        first: scenario.first,
        second: scenario.second,
        flowIdA,
        flowIdB,
        firstCreate,
        secondCreate: null,
        flowA: null,
        flowB: null,
        dbSnapshot: {
          available: false,
          reason: "First identity could not be created",
          emailMatches: [],
          usernameMatches: [],
          clerkIdMatches: [],
        },
        notes,
        cleanup: { deletedUserIds: cleanupDeleted, failedDeletes: cleanupFailed },
      };
    }

    const flowAResponse = await callTestAuthFlow(firstCreate.user.id, flowIdA);
    flowA = parseFlowResponse(flowAResponse.status, flowAResponse.body);

    secondCreate = await createEmailUser(clerk, scenario.second);

    if (secondCreate.ok && secondCreate.user) {
      const flowBResponse = await callTestAuthFlow(secondCreate.user.id, flowIdB);
      flowB = parseFlowResponse(flowBResponse.status, flowBResponse.body);
    } else {
      notes.push("Second identity could not be created in Clerk");
    }

    const createdIds = [firstCreate.user.id];
    if (secondCreate?.ok && secondCreate.user) {
      createdIds.push(secondCreate.user.id);
    }

    const dbSnapshot = await collectDbSnapshot(scenario, createdIds);
    const finishedAt = nowIso();

    const evidence: ExecutedScenarioEvidence = {
      id: scenario.id,
      kind: "executable",
      group: scenario.group,
      description: scenario.description,
      status: "executed",
      startedAt,
      finishedAt,
      classification: "pending",
      first: scenario.first,
      second: scenario.second,
      flowIdA,
      flowIdB,
      firstCreate,
      secondCreate,
      flowA,
      flowB,
      dbSnapshot,
      notes,
      cleanup: {
        deletedUserIds: cleanupDeleted,
        failedDeletes: cleanupFailed,
      },
    };

    evidence.classification = scenarioClassificationFromEvidence(evidence);
    return evidence;
  } finally {
    const idsToDelete = new Set<string>();
    if (firstCreate.ok && firstCreate.user) idsToDelete.add(firstCreate.user.id);
    if (secondCreate?.ok && secondCreate.user) idsToDelete.add(secondCreate.user.id);

    for (const userId of idsToDelete) {
      const ok = await deleteUserSafe(clerk, userId);
      if (ok) {
        cleanupDeleted.push(userId);
      } else {
        cleanupFailed.push(userId);
      }
    }
  }
}

function manualEvidenceFromScenario(
  scenario: ManualScenario,
): ManualScenarioEvidence {
  return {
    id: scenario.id,
    kind: "manual",
    group: scenario.group,
    description: scenario.description,
    status: "manual_required",
    startedAt: nowIso(),
    finishedAt: nowIso(),
    classification: "MANUAL_REQUIRED_OAUTH_PROVIDER_FLOW",
    blocker: scenario.blocker,
    manualSteps: scenario.manualSteps,
  };
}

function buildScenarios(mode: ModeArg): ScenarioDefinition[] {
  const emailScenarios: ScenarioDefinition[] = [
    {
      kind: "executable",
      id: "A1-email-diff-email-diff-username",
      group: "A-email",
      description: "Control: first and second signup use different email + different username",
      first: {
        provider: "email",
        email: makeEmail("a1-first"),
        username: makeUsername("a1first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a1-second"),
        username: makeUsername("a1second"),
      },
    },
    {
      kind: "executable",
      id: "A2-email-same-email-diff-username",
      group: "A-email",
      description: "Second signup reuses first email but different username",
      first: {
        provider: "email",
        email: makeEmail("a2-shared"),
        username: makeUsername("a2first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a2-shared"),
        username: makeUsername("a2second"),
      },
    },
    {
      kind: "executable",
      id: "A3-email-diff-email-same-username",
      group: "A-email",
      description: "Second signup reuses first username but different email",
      first: {
        provider: "email",
        email: makeEmail("a3-first"),
        username: makeUsername("a3shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("a3-second"),
        username: makeUsername("a3shared"),
      },
    },
    {
      kind: "executable",
      id: "A4-email-same-email-same-username",
      group: "A-email",
      description: "Second signup reuses first email and first username",
      first: {
        provider: "email",
        email: makeEmail("a4-shared"),
        username: makeUsername("a4shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("a4-shared"),
        username: makeUsername("a4shared"),
      },
    },
  ];

  const manualScenarios: ScenarioDefinition[] = [
    {
      kind: "manual",
      id: "B1-google-email-same-email",
      group: "B-google-email",
      description:
        "Cross-provider: first signup via Google, second signup via email/password with same email",
      blocker:
        "Automated creation/linking of Clerk external OAuth accounts is not exposed in Clerk Backend API for test scripts.",
      manualSteps: [
        "Start frontend and backend in development mode with auth diagnostics enabled.",
        "Sign up user A with Google using a real Google test account.",
        "Capture /api/user/me and /api/debug/auth-diagnostic evidence for user A.",
        "Sign out and attempt signup via email/password with the same email address.",
        "Capture /api/user/me status, UI conflict state, and backend logs with x-debug-flow-id.",
      ],
    },
    {
      kind: "manual",
      id: "C1-email-google-same-email",
      group: "C-email-google",
      description:
        "Cross-provider: first signup via email/password, second signup via Google with same email",
      blocker:
        "OAuth browser provider authentication requires real provider credentials and interactive consent flows.",
      manualSteps: [
        "Start frontend and backend in development mode with auth diagnostics enabled.",
        "Sign up user A with email/password.",
        "Capture /api/user/me and /api/debug/auth-diagnostic evidence for user A.",
        "Sign out and attempt signup/sign-in via Google with the same email address.",
        "Capture /api/user/me status, any conflict modal, and backend debug logs.",
      ],
    },
    {
      kind: "manual",
      id: "D1-microsoft-email-same-email",
      group: "D-microsoft",
      description:
        "Cross-provider: first signup via Microsoft, second signup via email/password with same email",
      blocker:
        "Automated Microsoft OAuth signups require external credentials and cannot be fully simulated via Clerk Backend API.",
      manualSteps: [
        "Start frontend and backend in development mode with auth diagnostics enabled.",
        "Sign up user A with Microsoft using a real Microsoft test account.",
        "Capture /api/user/me and /api/debug/auth-diagnostic evidence for user A.",
        "Sign out and attempt signup via email/password with the same email.",
        "Capture /api/user/me status and backend debug logs for both attempts.",
      ],
    },
    {
      kind: "manual",
      id: "D2-email-microsoft-same-email",
      group: "D-microsoft",
      description:
        "Cross-provider: first signup via email/password, second signup via Microsoft with same email",
      blocker:
        "Automated Microsoft OAuth sign-ins require provider-managed credentials and consent screens.",
      manualSteps: [
        "Start frontend and backend in development mode with auth diagnostics enabled.",
        "Sign up user A with email/password.",
        "Capture /api/user/me and /api/debug/auth-diagnostic evidence for user A.",
        "Sign out and attempt signup/sign-in via Microsoft with the same email.",
        "Capture /api/user/me status, UI conflict state, and backend logs.",
      ],
    },
  ];

  switch (mode) {
    case "email":
      return emailScenarios;
    case "google-email":
      return manualScenarios.filter((scenario) => scenario.id === "B1-google-email-same-email");
    case "email-google":
      return manualScenarios.filter((scenario) => scenario.id === "C1-email-google-same-email");
    case "microsoft-email":
      return manualScenarios.filter((scenario) => scenario.id === "D1-microsoft-email-same-email");
    case "email-microsoft":
      return manualScenarios.filter((scenario) => scenario.id === "D2-email-microsoft-same-email");
    case "full":
      return [...emailScenarios, ...manualScenarios];
  }
}

async function verifyBackendReady(): Promise<boolean> {
  const health = await fetch(`${BACKEND_URL}/health`).catch(() => null);
  if (!health || !health.ok) {
    return false;
  }

  const probe = await fetch(`${BACKEND_URL}/api/debug/test-auth-flow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({}),
  }).catch(() => null);

  // Diagnostics endpoint enabled should return 400 for missing clerkId.
  return !!probe && probe.status === 400;
}

async function connectMongoIfAvailable(): Promise<string | null> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    return "MONGO_URI missing";
  }

  try {
    await mongoose.connect(mongoUri, MONGO_OPTIONS);
    usersCollection = mongoose.connection.db?.collection("users") ?? null;
    if (!usersCollection) {
      return "Mongo connection established but users collection unavailable";
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(): Promise<void> {
  const mode = parseModeArg(process.argv[2]);
  const startedAt = nowIso();
  const runId = `auth-matrix-${mode}-${RUN_SEED}`;

  header("AUTH IDENTITY MATRIX RUNNER");
  log(`Mode: ${mode}`);
  log(`Run ID: ${runId}`);
  log(`Backend: ${BACKEND_URL}`);

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is missing in environment");
  }

  const diagnosticsEnabled = await verifyBackendReady();
  if (!diagnosticsEnabled) {
    throw new Error(
      "Backend not ready or auth diagnostics disabled. Ensure backend runs on localhost:4000 with ENABLE_AUTH_DIAGNOSTICS=true.",
    );
  }

  const mongoError = await connectMongoIfAvailable();
  if (mongoError) {
    log(`Mongo snapshot support disabled: ${mongoError}`);
  } else {
    log("Mongo snapshot support enabled");
  }

  const clerk = createClerkClient({ secretKey });
  const usersApiRecord = clerk.users as unknown as Record<string, unknown>;
  const capabilities = {
    clerkUsersApiMethods: {
      createUser: typeof usersApiRecord.createUser === "function",
      deleteUser: typeof usersApiRecord.deleteUser === "function",
      deleteUserExternalAccount:
        typeof usersApiRecord.deleteUserExternalAccount === "function",
      createUserExternalAccount:
        typeof usersApiRecord.createUserExternalAccount === "function",
    },
    oauthAutomationSupported: false,
    oauthAutomationBlocker:
      "Cross-provider OAuth scenarios require real provider authentication. Clerk Backend API exposes deleteUserExternalAccount but not create/link external OAuth accounts for test seeding.",
  };

  const scenarios = buildScenarios(mode);
  const scenarioEvidence: ScenarioEvidence[] = [];

  for (const scenario of scenarios) {
    header(`SCENARIO ${scenario.id}`);
    log(scenario.description);

    if (scenario.kind === "manual") {
      const evidence = manualEvidenceFromScenario(scenario);
      scenarioEvidence.push(evidence);
      const scenarioFile = writeJson(
        `scenario-${scenario.id}-${slugTime()}.json`,
        evidence,
      );
      log(`Status: manual required`);
      log(`Evidence: ${scenarioFile}`);
      continue;
    }

    const evidence = await runExecutableScenario(clerk, scenario);
    scenarioEvidence.push(evidence);
    const scenarioFile = writeJson(
      `scenario-${scenario.id}-${slugTime()}.json`,
      evidence,
    );
    log(`Classification: ${evidence.classification}`);
    log(`Evidence: ${scenarioFile}`);
  }

  const finishedAt = nowIso();

  const totals = {
    total: scenarioEvidence.length,
    executed: scenarioEvidence.filter((scenario) => scenario.status === "executed").length,
    manualRequired: scenarioEvidence.filter((scenario) => scenario.status === "manual_required").length,
    setupFailed: scenarioEvidence.filter((scenario) => scenario.status === "setup_failed").length,
  };

  const matrix: MatrixEvidence = {
    runId,
    mode,
    startedAt,
    finishedAt,
    backendUrl: BACKEND_URL,
    diagnosticsEndpointEnabled: diagnosticsEnabled,
    capabilities,
    scenarios: scenarioEvidence,
    totals,
  };

  const matrixFile = writeJson(
    `matrix-${mode}-${slugTime()}.json`,
    matrix,
  );

  header("MATRIX SUMMARY");
  for (const scenario of scenarioEvidence) {
    log(`${scenario.id}: ${scenario.classification}`);
  }
  log("");
  log(`Executed: ${totals.executed}`);
  log(`Manual required: ${totals.manualRequired}`);
  log(`Setup failed: ${totals.setupFailed}`);
  log(`Matrix evidence: ${matrixFile}`);

  if (usersCollection) {
    await mongoose.disconnect();
  }

  process.exitCode = totals.setupFailed > 0 ? 1 : 0;
}

main().catch(async (error) => {
  process.stderr.write(
    `FATAL: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  if (usersCollection) {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exitCode = 1;
});

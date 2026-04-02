#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Auth Duplicate Reproduction — Pure API Test
 *
 * Tests findOrCreateUserByClerkId directly via the debug endpoint.
 * Creates real Clerk test users via Backend API, then calls
 * POST /api/debug/test-auth-flow to trigger the same code path
 * that runs on every /me request.
 *
 * Flow:
 *   1. Create Clerk user A (email + username)
 *   2. Call test-auth-flow with user A's clerkId → creates local user
 *   3. Create Clerk user B (DIFFERENT email, SAME username)
 *   4. Call test-auth-flow with user B's clerkId → should hit username conflict
 *   5. Classify result
 *   6. Clean up: delete Clerk test users
 *
 * Usage: pnpm test:auth:repro
 * Requires:
 *   - Backend running on localhost:4000
 *   - ENABLE_AUTH_DIAGNOSTICS=true in backend/.env
 *   - CLERK_SECRET_KEY in backend/.env
 */
import "../helpers/env.js";
import { BACKEND_URL } from "../helpers/env.js";
import { log, header } from "../helpers/log.js";
import { createClerkClient } from "@clerk/backend";

// ---------- Config ----------
const TIMESTAMP = Date.now();
const TEST_EMAIL_A = `test-repro-a-${TIMESTAMP}@example.com`;
const TEST_EMAIL_B = `test-repro-b-${TIMESTAMP}@example.com`;
const TEST_USERNAME = `reprouser${TIMESTAMP}`;
const TEST_USERNAME_B = `reprouser${TIMESTAMP}b`;
const TEST_PASSWORD = process.env.TEST_CLERK_PASSWORD ?? "ReproTest123!"; // eslint-disable-line
const FLOW_ID_A = `repro-api-A-${TIMESTAMP}`;
const FLOW_ID_B = `repro-api-B-${TIMESTAMP}`;

interface Evidence {
  timestamp: string;
  testEmailA: string;
  testEmailB: string;
  testUsername: string;
  clerkUserA: { id: string; email: string; username: string | null } | null;
  clerkUserB: { id: string; email: string; username: string | null } | null;
  flowResultA: { classification: string; result: unknown } | null;
  flowResultB: { classification: string; result: unknown } | null;
  dbCheckAfter: unknown;
  classification: string;
  cleanup: { userADeleted: boolean; userBDeleted: boolean };
  clerkBlockedDuplicateUsername: boolean;
}

// ---------- Clerk Client ----------
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) {
  log("ERROR: CLERK_SECRET_KEY not set. Add it to backend/.env");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey });

// ---------- Helpers ----------

async function callTestAuthFlow(
  clerkId: string,
  flowId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BACKEND_URL}/api/debug/test-auth-flow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      "Origin": BACKEND_URL,
    },
    body: JSON.stringify({ clerkId, flowId }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function deleteClerkUser(userId: string): Promise<boolean> {
  try {
    await clerk.users.deleteUser(userId);
    return true;
  } catch (e) {
    log(`  WARNING: Failed to delete Clerk user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ---------- Main ----------
async function main() {
  const evidence: Evidence = {
    timestamp: new Date().toISOString(),
    testEmailA: TEST_EMAIL_A,
    testEmailB: TEST_EMAIL_B,
    testUsername: TEST_USERNAME,
    clerkUserA: null,
    clerkUserB: null,
    flowResultA: null,
    flowResultB: null,
    dbCheckAfter: null,
    classification: "pending",
    cleanup: { userADeleted: false, userBDeleted: false },
    clerkBlockedDuplicateUsername: false,
  };

  try {
    // ---- Step 0: Verify backend is reachable ----
    header("STEP 0: Verify backend");
    try {
      const healthRes = await fetch(`${BACKEND_URL}/health`);
      if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
      log("  Backend is healthy");
    } catch {
      log(`  ERROR: Backend not reachable at ${BACKEND_URL}`);
      log(`  Make sure backend is running with ENABLE_AUTH_DIAGNOSTICS=true`);
      process.exit(1);
    }

    // ---- Step 1: Create Clerk user A ----
    header("STEP 1: Create Clerk user A");
    log(`  Email: ${TEST_EMAIL_A}`);
    log(`  Username: ${TEST_USERNAME}`);
    try {
      const userA = await clerk.users.createUser({
        emailAddress: [TEST_EMAIL_A],
        password: TEST_PASSWORD,
        username: TEST_USERNAME,
        firstName: "Test",
        lastName: "ReproA",
        skipPasswordChecks: true,
      });
      evidence.clerkUserA = {
        id: userA.id,
        email: userA.emailAddresses[0]?.emailAddress ?? "unknown",
        username: userA.username,
      };
      log(`  Created Clerk user A: ${userA.id}`);
      log(`  Email: ${evidence.clerkUserA.email}`);
      log(`  Username: ${evidence.clerkUserA.username}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const clerkErrors = (e as { errors?: Array<{ code?: string; message?: string; longMessage?: string }> }).errors;
      if (clerkErrors) {
        log(`  Clerk API errors:`);
        for (const err of clerkErrors) {
          log(`    code: ${err.code}, message: ${err.message}, longMessage: ${err.longMessage}`);
        }
      }
      log(`  ERROR creating Clerk user A: ${msg}`);
      evidence.classification = `CLERK_ERROR_CREATE_A: ${msg}`;
      printSummary(evidence);
      return;
    }

    // ---- Step 2: Call test-auth-flow for user A ----
    header("STEP 2: Call findOrCreateUserByClerkId for user A");
    log(`  ClerkId: ${evidence.clerkUserA.id}`);
    log(`  FlowId: ${FLOW_ID_A}`);
    const resultA = await callTestAuthFlow(evidence.clerkUserA.id, FLOW_ID_A);
    log(`  HTTP status: ${resultA.status}`);
    log(`  Response: ${JSON.stringify(resultA.body, null, 2)}`);
    evidence.flowResultA = resultA.body as Evidence["flowResultA"];

    if (resultA.status === 404) {
      log("\n  ERROR: Endpoint returned 404. Is ENABLE_AUTH_DIAGNOSTICS=true set in backend/.env?");
      evidence.classification = "ENDPOINT_NOT_ENABLED";
      printSummary(evidence);
      return;
    }

    // ---- Step 3: Create Clerk user B (different email, try SAME username then fallback) ----
    header("STEP 3: Create Clerk user B (same username, different email)");
    log(`  Email: ${TEST_EMAIL_B}`);
    log(`  Username: ${TEST_USERNAME} (SAME as user A)`);
    try {
      const userB = await clerk.users.createUser({
        emailAddress: [TEST_EMAIL_B],
        password: TEST_PASSWORD,
        username: TEST_USERNAME,
        firstName: "Test",
        lastName: "ReproB",
        skipPasswordChecks: true,
      });
      evidence.clerkUserB = {
        id: userB.id,
        email: userB.emailAddresses[0]?.emailAddress ?? "unknown",
        username: userB.username,
      };
      log(`  Created Clerk user B: ${userB.id}`);
      log(`  Email: ${evidence.clerkUserB.email}`);
      log(`  Username: ${evidence.clerkUserB.username}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const clerkErrors = (e as { errors?: Array<{ code?: string; message?: string; longMessage?: string }> }).errors;
      if (clerkErrors) {
        for (const err of clerkErrors) {
          log(`    Clerk error: code=${err.code}, message=${err.message}`);
        }
      }
      log(`  Clerk BLOCKED creating user B with same username: ${msg}`);
      evidence.clerkBlockedDuplicateUsername = true;

      // Fall back: create user B with a DIFFERENT username
      log(`\n  Creating user B with DIFFERENT username (${TEST_USERNAME_B}) to test parallel flow...`);
      try {
        const userB2 = await clerk.users.createUser({
          emailAddress: [TEST_EMAIL_B],
          password: TEST_PASSWORD,
          username: TEST_USERNAME_B,
          firstName: "Test",
          lastName: "ReproB",
          skipPasswordChecks: true,
        });
        evidence.clerkUserB = {
          id: userB2.id,
          email: userB2.emailAddresses[0]?.emailAddress ?? "unknown",
          username: userB2.username,
        };
        log(`  Created Clerk user B: ${userB2.id}`);
        log(`  Email: ${evidence.clerkUserB.email}`);
        log(`  Username: ${evidence.clerkUserB.username}`);
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        const clerkErrors2 = (e2 as { errors?: Array<{ code?: string; message?: string; longMessage?: string }> }).errors;
        if (clerkErrors2) {
          for (const err of clerkErrors2) {
            log(`    Clerk error: code=${err.code}, message=${err.message}`);
          }
        }
        log(`  Also failed creating user B with different username: ${msg2}`);
        evidence.classification = `CLERK_ERROR_CREATE_B: ${msg2}`;
        printSummary(evidence);
        evidence.cleanup.userADeleted = await deleteClerkUser(evidence.clerkUserA.id);
        return;
      }
    }

    // ---- Step 4: Call test-auth-flow for user B ----
    header("STEP 4: Call findOrCreateUserByClerkId for user B");
    log(`  ClerkId: ${evidence.clerkUserB!.id}`);
    log(`  FlowId: ${FLOW_ID_B}`);
    const resultB = await callTestAuthFlow(evidence.clerkUserB!.id, FLOW_ID_B);
    log(`  HTTP status: ${resultB.status}`);
    log(`  Response: ${JSON.stringify(resultB.body, null, 2)}`);
    evidence.flowResultB = resultB.body as Evidence["flowResultB"];

    // ---- Step 5: Classify ----
    header("STEP 5: Classification");
    evidence.classification = classify(evidence);
    log(`  ${evidence.classification}`);

  } finally {
    // ---- Cleanup: Delete test Clerk users ----
    header("CLEANUP: Deleting test Clerk users");
    if (evidence.clerkUserA) {
      evidence.cleanup.userADeleted = await deleteClerkUser(evidence.clerkUserA.id);
      log(`  User A (${evidence.clerkUserA.id}): ${evidence.cleanup.userADeleted ? "deleted" : "FAILED"}`);
    }
    if (evidence.clerkUserB) {
      evidence.cleanup.userBDeleted = await deleteClerkUser(evidence.clerkUserB.id);
      log(`  User B (${evidence.clerkUserB.id}): ${evidence.cleanup.userBDeleted ? "deleted" : "FAILED"}`);
    }

    printSummary(evidence);
    log(`\nFull evidence JSON:\n${JSON.stringify(evidence, null, 2)}`);
  }
}

function classify(evidence: Evidence): string {
  const a = evidence.flowResultA;
  const b = evidence.flowResultB;

  if (!a || !b) return "INCOMPLETE — one or both auth flow calls failed";

  const aClass = (a as { classification?: string }).classification ?? "";
  const bClass = (b as { classification?: string }).classification ?? "";

  if (bClass.includes("conflict_or_error")) {
    const bResult = (b as { result?: { type?: string } }).result;
    if (bResult?.type === "usernameConflict") {
      return "BACKEND_CORRECTLY_BLOCKED_USERNAME — findOrCreateUserByClerkId returned usernameConflict for user B. No duplicate in DB.";
    }
    if (bResult?.type === "accountConflict") {
      return "BACKEND_CORRECTLY_BLOCKED_OAUTH — findOrCreateUserByClerkId returned accountConflict for user B.";
    }
    return `BACKEND_BLOCKED — user B got conflict result: ${bResult?.type ?? "unknown"}`;
  }

  if (aClass.includes("success") && bClass.includes("success")) {
    const aResult = (a as { result?: { _id?: string; email?: string; username?: string } }).result;
    const bResult = (b as { result?: { _id?: string; email?: string; username?: string } }).result;

    if (aResult?._id && bResult?._id) {
      if (String(aResult._id) === String(bResult._id)) {
        return "SAME_LOCAL_USER — Both Clerk users mapped to the same local user. Possible relink or merge.";
      }
      const prefix = evidence.clerkBlockedDuplicateUsername
        ? "TWO_USERS_DIFFERENT_USERNAMES"
        : "REAL_DUPLICATE";
      const detail = evidence.clerkBlockedDuplicateUsername
        ? "Clerk blocked same username; user B created with different username. Both got separate local users (expected)."
        : `Two different local users created! A=${aResult._id} B=${bResult._id}. This is the bug.`;
      return `${prefix} — ${detail}`;
    }
  }

  if (aClass.includes("success") && bClass.includes("null")) {
    return "USER_B_NULL — findOrCreateUserByClerkId returned null for user B. Clerk profile fetch probably failed.";
  }

  return `UNRESOLVED — A: ${aClass}, B: ${bClass}`;
}

function printSummary(evidence: Evidence) {
  header("EVIDENCE SUMMARY");
  log(`  Timestamp:      ${evidence.timestamp}`);
  log(`  Test username:  ${evidence.testUsername}`);
  log(`  Email A:        ${evidence.testEmailA}`);
  log(`  Email B:        ${evidence.testEmailB}`);
  log("");
  log("  --- Clerk User A ---");
  if (evidence.clerkUserA) {
    log(`  Clerk ID:     ${evidence.clerkUserA.id}`);
    log(`  Email:        ${evidence.clerkUserA.email}`);
    log(`  Username:     ${evidence.clerkUserA.username}`);
  } else {
    log("  (not created)");
  }
  log("");
  log("  --- Clerk User B ---");
  if (evidence.clerkUserB) {
    log(`  Clerk ID:     ${evidence.clerkUserB.id}`);
    log(`  Email:        ${evidence.clerkUserB.email}`);
    log(`  Username:     ${evidence.clerkUserB.username}`);
  } else {
    log("  (not created)");
  }
  log("");
  log("  --- Auth Flow Results ---");
  if (evidence.flowResultA) {
    const a = evidence.flowResultA as { classification?: string };
    log(`  User A: ${a.classification ?? "N/A"}`);
  } else {
    log("  User A: (not tested)");
  }
  if (evidence.flowResultB) {
    const b = evidence.flowResultB as { classification?: string };
    log(`  User B: ${b.classification ?? "N/A"}`);
  } else {
    log("  User B: (not tested)");
  }
  log("");
  log(`  CLASSIFICATION: ${evidence.classification}`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});

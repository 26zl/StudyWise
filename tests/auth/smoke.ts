#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Auth røyktester (HTTP-nivå).
 * Verifiserer auth-vaktoppførsel og offentlig brukernavn-sjekk-endepunkt.
 */
import "../helpers/env.js";
import { BACKEND_URL } from "../helpers/env.js";
import { header, log } from "../helpers/log.js";

type StepResult = {
  name: string;
  ok: boolean;
  detail: string;
};

async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function matchesStatus(status: number, expected: number | number[]): boolean {
  return Array.isArray(expected) ? expected.includes(status) : status === expected;
}

function pushResult(
  results: StepResult[],
  name: string,
  status: number,
  expected: number | number[],
  extra = "",
) {
  const ok = matchesStatus(status, expected);
  const expectedText = Array.isArray(expected) ? expected.join("/") : String(expected);
  results.push({
    name,
    ok,
    detail: `${ok ? "OK" : "FAIL"} status=${status}, expected=${expectedText}${extra ? `, ${extra}` : ""}`,
  });
}

async function main() {
  header("AUTH SMOKE TESTS");

  const results: StepResult[] = [];

  const health = await requestJson("/health");
  pushResult(results, "GET /health", health.status, 200);

  const usernameCheck = await requestJson("/api/user/username/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({ username: `smokeuser${Date.now()}` }),
  });
  const hasAvailableFlag =
    typeof usernameCheck.body === "object" &&
    usernameCheck.body !== null &&
    "available" in usernameCheck.body;
  pushResult(
    results,
    "POST /api/user/username/check",
    usernameCheck.status,
    200,
    `availableFlag=${hasAvailableFlag}`,
  );
  if (!hasAvailableFlag) {
    results.push({
      name: "username/check schema",
      ok: false,
      detail: "FAIL missing 'available' in response",
    });
  }

  const meNoAuth = await requestJson("/api/user/me");
  pushResult(results, "GET /api/user/me (no auth)", meNoAuth.status, 401);

  const logoutNoAuth = await requestJson("/api/user/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({}),
  });
  pushResult(results, "POST /api/user/logout (no auth)", logoutNoAuth.status, 401);

  const debugNoBody = await requestJson("/api/debug/test-auth-flow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({}),
  });
  pushResult(
    results,
    "POST /api/debug/test-auth-flow (missing clerkId)",
    debugNoBody.status,
    [400, 404],
  );

  header("AUTH SMOKE SUMMARY");
  for (const result of results) {
    log(`  ${result.ok ? "[PASS]" : "[FAIL]"} ${result.name} -> ${result.detail}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  const passed = results.length - failed;
  log(`\n  Passed: ${passed}`);
  log(`  Failed: ${failed}`);

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Canvas røyktester (HTTP-nivå).
 * Verifiserer rutebeskyttelse og grunnleggende statuskoder.
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
) {
  const ok = matchesStatus(status, expected);
  const expectedText = Array.isArray(expected) ? expected.join("/") : String(expected);
  results.push({
    name,
    ok,
    detail: `${ok ? "OK" : "FAIL"} status=${status}, expected=${expectedText}`,
  });
}

async function main() {
  header("CANVAS SMOKE TESTS");

  const results: StepResult[] = [];

  const health = await requestJson("/health");
  pushResult(results, "GET /health", health.status, 200);

  const whoamiNoAuth = await requestJson("/api/canvas/whoami");
  pushResult(results, "GET /api/canvas/whoami (no auth)", whoamiNoAuth.status, 401);

  const emnerNoAuth = await requestJson("/api/canvas/emner");
  pushResult(results, "GET /api/canvas/emner (no auth)", emnerNoAuth.status, 401);

  const kalenderNoAuth = await requestJson("/api/canvas/kalender");
  pushResult(results, "GET /api/canvas/kalender (no auth)", kalenderNoAuth.status, 401);

  const todoNoAuth = await requestJson("/api/canvas/users/self/todo");
  pushResult(results, "GET /api/canvas/users/self/todo (no auth)", todoNoAuth.status, 401);

  header("CANVAS SMOKE SUMMARY");
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

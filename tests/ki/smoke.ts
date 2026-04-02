#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * KI røyktester (HTTP-nivå).
 * Verifiserer auth-vakter og offentlig delt-chat ruteoppførsel.
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
  header("KI SMOKE TESTS");

  const results: StepResult[] = [];

  const health = await requestJson("/health");
  pushResult(results, "GET /health", health.status, 200);

  const modelsNoAuth = await requestJson("/api/ki/models");
  pushResult(results, "GET /api/ki/models (no auth)", modelsNoAuth.status, 401);

  const chatNoAuth = await requestJson("/api/ki/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-studywise-csrf": "1",
      Origin: BACKEND_URL,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hei" }],
      temperature: 0.7,
    }),
  });
  pushResult(results, "POST /api/ki/chat (no auth)", chatNoAuth.status, 401);

  const sharedInvalidId = await requestJson("/api/ki/share/not-a-valid-id");
  pushResult(results, "GET /api/ki/share/not-a-valid-id", sharedInvalidId.status, 404);

  const testBearer = process.env.TEST_AUTH_BEARER;
  if (testBearer) {
    const modelsAuth = await requestJson("/api/ki/models", {
      headers: { Authorization: `Bearer ${testBearer}` },
    });

    const bodyHasModels =
      typeof modelsAuth.body === "object" &&
      modelsAuth.body !== null &&
      "models" in modelsAuth.body &&
      "defaultModel" in modelsAuth.body;

    pushResult(
      results,
      "GET /api/ki/models (with TEST_AUTH_BEARER)",
      modelsAuth.status,
      200,
      `shapeOk=${bodyHasModels}`,
    );

    if (!bodyHasModels) {
      results.push({
        name: "KI models response schema",
        ok: false,
        detail: "FAIL missing models/defaultModel",
      });
    }
  } else {
    results.push({
      name: "GET /api/ki/models (with TEST_AUTH_BEARER)",
      ok: true,
      detail: "SKIP TEST_AUTH_BEARER not set",
    });
  }

  header("KI SMOKE SUMMARY");
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

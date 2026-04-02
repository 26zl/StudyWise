#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Unified Test Runner
 *
 * Runs test suites by category. Each category has one or more scripts.
 *
 * Usage:
 *   tsx run.ts              # Run ALL categories
 *   tsx run.ts auth         # Run only auth tests
 *   tsx run.ts ki           # Run only KI tests
 *   tsx run.ts canvas       # Run only Canvas tests
 */
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestSuite {
  name: string;
  description: string;
  scripts: { name: string; command: string; requiresBackend?: boolean }[];
}

const SUITES: TestSuite[] = [
  {
    name: "auth",
    description: "Authentication & user identity tests",
    scripts: [
      {
        name: "DB invariant check",
        command: "tsx auth/check-db.ts",
      },
      {
        name: "HTTP auth smoke",
        command: "tsx auth/smoke.ts",
        requiresBackend: true,
      },
      {
        name: "API duplicate repro",
        command: "tsx auth/repro-api.ts",
        requiresBackend: true,
      },
    ],
  },
  {
    name: "ki",
    description: "KI/AI feature tests",
    scripts: [
      {
        name: "KI HTTP smoke",
        command: "tsx ki/smoke.ts",
        requiresBackend: true,
      },
    ],
  },
  {
    name: "canvas",
    description: "Canvas LMS integration tests",
    scripts: [
      {
        name: "Canvas HTTP smoke",
        command: "tsx canvas/smoke.ts",
        requiresBackend: true,
      },
    ],
  },
];

// ---------- Helpers ----------
function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

function banner(msg: string) {
  const line = "═".repeat(64);
  log(`\n${line}`);
  log(`  ${msg}`);
  log(line);
}

async function isBackendHealthy(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:4000/health");
    return res.ok;
  } catch {
    return false;
  }
}

function runScript(command: string): boolean {
  try {
    execSync(command, {
      cwd: __dirname,
      stdio: "inherit",
      env: { ...process.env },
    });
    return true;
  } catch {
    return false;
  }
}

// ---------- Main ----------
async function main() {
  const requestedCategory = process.argv[2]?.toLowerCase();
  const suitesToRun = requestedCategory
    ? SUITES.filter((s) => s.name === requestedCategory)
    : SUITES;

  if (requestedCategory && suitesToRun.length === 0) {
    log(`Unknown test category: "${requestedCategory}"`);
    log(`Available: ${SUITES.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  const backendUp = await isBackendHealthy();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const results: { suite: string; script: string; status: "pass" | "fail" | "skip" }[] = [];

  for (const suite of suitesToRun) {
    if (suite.scripts.length === 0) {
      log(`\n  [${suite.name}] No tests yet — skipping`);
      continue;
    }

    banner(`${suite.name.toUpperCase()} — ${suite.description}`);

    for (const script of suite.scripts) {
      log(`\n  ▸ ${script.name}`);

      if (script.requiresBackend && !backendUp) {
        log(`    SKIPPED — backend not running on localhost:4000`);
        totalSkipped++;
        results.push({ suite: suite.name, script: script.name, status: "skip" });
        continue;
      }

      const ok = runScript(script.command);
      if (ok) {
        totalPassed++;
        results.push({ suite: suite.name, script: script.name, status: "pass" });
      } else {
        totalFailed++;
        results.push({ suite: suite.name, script: script.name, status: "fail" });
      }
    }
  }

  // ---------- Summary ----------
  banner("TEST RESULTS");
  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "○";
    log(`  ${icon}  [${r.suite}] ${r.script}`);
  }
  log("");
  log(`  Passed: ${totalPassed}  Failed: ${totalFailed}  Skipped: ${totalSkipped}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();

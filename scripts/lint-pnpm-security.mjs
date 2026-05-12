/*
 * Dette skriptet sjekker `pnpm-workspace.yaml` for å sikre at `minimumReleaseAge` er satt til minst 7200 minutter (5 dager).
 */

import { readFileSync } from "node:fs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const MINIMUM_RELEASE_AGE_MINUTES = 7200;

const source = readFileSync(WORKSPACE_FILE, "utf8");
const match = source.match(/^minimumReleaseAge:\s*(\d+)\s*(?:#.*)?$/m);

if (!match) {
  console.error(
    `pnpm supply-chain guardrail failed: ${WORKSPACE_FILE} must define minimumReleaseAge: ${MINIMUM_RELEASE_AGE_MINUTES}`,
  );
  process.exit(1);
}

const minimumReleaseAge = Number(match[1]);

if (!Number.isInteger(minimumReleaseAge) || minimumReleaseAge < MINIMUM_RELEASE_AGE_MINUTES) {
  console.error(
    `pnpm supply-chain guardrail failed: minimumReleaseAge must be at least ${MINIMUM_RELEASE_AGE_MINUTES} minutes, got ${match[1]}.`,
  );
  process.exit(1);
}

console.log(
  `pnpm supply-chain guardrails passed (${minimumReleaseAge} minute minimum release age).`,
);

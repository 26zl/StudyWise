#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const shouldSkip =
  process.env.CI === "true" || process.env.HUSKY === "0" || process.env.NODE_ENV === "production";

if (shouldSkip) {
  console.log("Skipping husky install in CI/production.");
  process.exit(0);
}

const result = spawnSync("husky", {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error?.code === "ENOENT") {
  console.log("Skipping husky install because husky is not installed.");
  process.exit(0);
}

process.exit(result.status ?? 1);

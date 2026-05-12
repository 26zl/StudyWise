#!/usr/bin/env node

// Dette skriptet oppdaterer dependencies

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const filterIndex = args.indexOf("--filter");
const workspaceFilter = filterIndex === -1 ? null : args[filterIndex + 1];

if (filterIndex !== -1 && !workspaceFilter) {
  console.error("Missing value for --filter");
  process.exit(1);
}

const filesToProtect = [
  "package.json",
  "backend/package.json",
  "frontend/package.json",
  "common/package.json",
  "docs/package.json",
  "tests/package.json",
  "pnpm-lock.yaml",
];

const snapshots = new Map();
for (const file of filesToProtect) {
  const fullPath = path.join(rootDir, file);
  snapshots.set(file, {
    exists: fs.existsSync(fullPath),
    content: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null,
  });
}

function restoreSnapshots() {
  for (const [file, snapshot] of snapshots) {
    const fullPath = path.join(rootDir, file);
    if (snapshot.exists) {
      fs.writeFileSync(fullPath, snapshot.content);
    } else if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runChecked(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function isMinimumReleaseAgeFailure(output) {
  return output.includes("ERR_PNPM_NO_MATURE_MATCHING_VERSION");
}

function handleFailure(step, result) {
  restoreSnapshots();

  if (isMinimumReleaseAgeFailure(result.output)) {
    console.warn(
      `\n${step} stoppet fordi en ny npm-versjon er yngre enn minimumReleaseAge. ` +
        "Dette er forventet beskyttelse, ikke en repo-feil. Beholder eksisterende lockfile.",
    );

    const installStatus = runChecked("pnpm", ["install", "--frozen-lockfile"]);
    if (installStatus !== 0) process.exit(installStatus);

    const syncpackStatus = runChecked("pnpm", ["syncpack:list"]);
    process.exit(syncpackStatus);
  }

  console.error(`\n${step} feilet. Gjenopprettet package.json-filer og pnpm-lock.yaml.`);
  process.exit(result.status);
}

const updateArgs = workspaceFilter
  ? ["--filter", workspaceFilter, "update"]
  : ["-r", "update"];

const steps = [
  ["Oppdaterer dependencies", "pnpm", updateArgs],
  ["Installerer oppdatert lockfile", "pnpm", ["install"]],
  ["Synkroniserer package.json-ranger", "pnpm", ["syncpack:fix"]],
  ["Installerer etter syncpack", "pnpm", ["install"]],
];

for (const [label, command, commandArgs] of steps) {
  console.log(`\n> ${label}`);
  const result = run(command, commandArgs);
  if (result.status !== 0) {
    handleFailure(label, result);
  }
}

/*
 * Sjekker GitHub Actions for trust-boundary-regler:
 * ingen pull_request_target, delte cacher eller uverifiserte installere
 * i deploy/publish/release/privilegerte workflows.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";

const sensitiveNamePattern = /(^|[._-])(deploy|publish|release)([._-]|$)/i;
const sensitiveContentPatterns = [
  /\$\{\{\s*secrets\./i,
  /^\s*(actions|checks|contents|deployments|id-token|issues|packages|pages|pull-requests|statuses):\s*write\s*$/im,
];

const cachePatterns = [
  {
    pattern: /^\s*cache\s*:/i,
    reason: "package-manager cache key",
  },
  {
    pattern: /^\s*cache-dependency-path\s*:/i,
    reason: "package-manager cache dependency path",
  },
  {
    pattern: /^\s*uses\s*:\s*actions\/cache(?:\/|@)/i,
    reason: "actions/cache usage",
  },
  {
    pattern: /^\s*uses\s*:\s*actions\/cache\/(?:restore|save)(?:\/|@)/i,
    reason: "actions/cache restore/save usage",
  },
  {
    pattern: /^\s*restore-keys\s*:/i,
    reason: "cache restore keys",
  },
];

const unsafeInstallPatterns = [
  {
    pattern: /\bnpm\s+install\s+(?:--global|-g)\b/i,
    reason: "global npm install",
  },
  {
    pattern: /\bcurl\b.*\|\s*(?:sh|bash)\b/i,
    reason: "curl pipe shell",
  },
  {
    pattern: /install-safe-chain\.sh/i,
    reason: "unverified safe-chain install script",
  },
];

const workflowFiles = readdirSync(WORKFLOW_DIR)
  .filter((file) => /\.ya?ml$/i.test(file))
  .map((file) => join(WORKFLOW_DIR, file));

const findings = [];

for (const file of workflowFiles) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const fileName = basename(file);
  const workflowName = source.match(/^name:\s*(.+)$/im)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
  const isSensitiveWorkflow =
    sensitiveNamePattern.test(fileName) ||
    /\b(deploy|publish|release)\b/i.test(workflowName) ||
    sensitiveContentPatterns.some((pattern) => pattern.test(source));

  lines.forEach((line, index) => {
    if (line.includes("pull_request_target")) {
      findings.push({
        file,
        line: index + 1,
        message: "`pull_request_target` is not allowed in this repository.",
      });
    }

    if (!isSensitiveWorkflow) {
      return;
    }

    const cacheMatch = cachePatterns.find(({ pattern }) => pattern.test(line));
    if (cacheMatch) {
      findings.push({
        file,
        line: index + 1,
        message: `Shared caches are not allowed in privileged, deploy, publish or release workflows (${cacheMatch.reason}).`,
      });
    }

    const unsafeInstallMatch = unsafeInstallPatterns.find(({ pattern }) => pattern.test(line));
    if (unsafeInstallMatch) {
      findings.push({
        file,
        line: index + 1,
        message: `Unverified installer patterns are not allowed in privileged, deploy, publish or release workflows (${unsafeInstallMatch.reason}).`,
      });
    }
  });
}

if (findings.length > 0) {
  console.error("GitHub Actions security guardrails failed:\n");

  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.message}`);
  }

  console.error(
    "\nUse ordinary `pull_request` workflows for PR validation, keep privileged/deploy workflows on clean installs without shared package-manager caches, and install external tools through pinned, verified paths.",
  );
  process.exit(1);
}

console.log("GitHub Actions security guardrails passed.");

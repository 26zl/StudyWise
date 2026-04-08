#!/usr/bin/env node
/*
 * Soft-delete query lint
 * ----------------------
 * Defense-in-depth: alle Mongoose-queries mot User-modellen MÅ filtrere
 * `deletedAt: { $exists: false }` med mindre kall-stedet eksplisitt vil ha
 * tilgang til soft-deleted brukere (admin-stats, GDPR-konfliktsjekk, migrasjon).
 *
 * Scriptet skanner backend/src/**\/*.ts (utenom tester og dist), finner alle
 * `User.find*`-kall, og verifiserer at hvert kall enten:
 *   1. Inneholder `deletedAt` i query-objektet (innenfor 20 linjer etter kallet), eller
 *   2. Bruker en kjent "active filter"-konstant (`ACTIVE_FILTER`, `activeFilter`,
 *      `activeConflictFilter`), eller
 *   3. Har en eksplisitt allowlist-kommentar over kall-stedet:
 *      `// allow-deleted-users: <begrunnelse>`
 *
 * Brukes som CI-gate (`pnpm lint:soft-delete`) for å fange nye queries som
 * glemmer filteret — en av de viktigste IDOR-vektorene i StudyWise.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const SCAN_DIR = join(ROOT, "backend", "src");

// Filer som skal hoppes over helt (intentionelle unntak)
const SKIP_PATHS = [
  "__tests__",
  "/dist/",
  "\\dist\\",
  // Migrasjoner trenger å se ALL data, inkludert soft-deleted brukere,
  // for å gjøre engangsoppdateringer
  "database/migrations.ts",
  "database\\migrations.ts",
];

// Konstant-navn som indikerer at en query bruker active-filter via spread
const ACTIVE_FILTER_TOKENS = [
  "ACTIVE_FILTER",
  "activeFilter",
  "activeConflictFilter",
  "activeUserFilter",
];

// Mønster for User-queries vi vil verifisere
const QUERY_PATTERN = /\bUser\.(find|findOne|findById|findByIdAndUpdate|findOneAndUpdate|findOneAndDelete|countDocuments|updateOne|updateMany|deleteOne|deleteMany)\s*\(/g;

const ALLOW_COMMENT = /allow-deleted-users\s*:/i;
const WINDOW_LINES_AFTER = 25;
// Vi skanner også LINJER FØR kallet — `filter`-variabler defineres ofte rett over.
// 15 linjer er nok for typiske rute-handlere uten å fange opp uvedkommende treff.
const WINDOW_LINES_BEFORE = 15;

function* walkTs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walkTs(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function shouldSkip(path) {
  const norm = path.replace(/\\/g, "/");
  return SKIP_PATHS.some((needle) => norm.includes(needle.replace(/\\/g, "/")));
}

function checkFile(path) {
  const violations = [];
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  for (const match of text.matchAll(QUERY_PATTERN)) {
    const idx = match.index ?? 0;
    const lineNo = text.slice(0, idx).split("\n").length;

    // Hent vindu både før og etter kall-stedet
    const windowStart = Math.max(0, lineNo - 1 - WINDOW_LINES_BEFORE);
    const windowEnd = Math.min(lines.length, lineNo + WINDOW_LINES_AFTER);
    const beforeWindow = lines.slice(windowStart, lineNo - 1).join("\n");
    const afterWindow = lines.slice(lineNo - 1, windowEnd).join("\n");
    const fullWindow = `${beforeWindow}\n${afterWindow}`;

    // Allowlist-kommentar i nærheten av kall-stedet (før eller rett etter)
    if (ALLOW_COMMENT.test(beforeWindow) || ALLOW_COMMENT.test(afterWindow)) continue;

    // Inline deletedAt-filter, eller spread/referanse til en aktiv filter-variabel,
    // ELLER en nærliggende `filter`-konstant som inneholder deletedAt
    if (fullWindow.includes("deletedAt")) continue;
    if (ACTIVE_FILTER_TOKENS.some((token) => fullWindow.includes(token))) continue;

    violations.push({
      file: relative(ROOT, path).replace(/\\/g, "/"),
      line: lineNo,
      preview: lines[lineNo - 1].trim(),
    });
  }
  return violations;
}

function main() {
  let allViolations = [];
  for (const file of walkTs(SCAN_DIR)) {
    if (shouldSkip(file)) continue;
    allViolations = allViolations.concat(checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log("✓ lint-soft-delete: alle User-queries er ryddige");
    process.exit(0);
  }

  console.error(
    `✗ lint-soft-delete: ${allViolations.length} User-query(er) mangler soft-delete-filter\n`,
  );
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.preview}`);
  }
  console.error(
    "\nFIKS:" +
      "\n  1. Legg til `deletedAt: { $exists: false }` i query-objektet, ELLER" +
      "\n  2. Bruk en kjent active-filter-konstant (ACTIVE_FILTER, activeFilter), ELLER" +
      "\n  3. Hvis kall-stedet ELT trenger soft-deleted brukere (admin-stats, GDPR-konflikt)," +
      "\n     legg til kommentar `// allow-deleted-users: <kort begrunnelse>` over kall-stedet.\n",
  );
  process.exit(1);
}

main();

/*
 * Dette skriptet genererer en CycloneDX Software Bill of Materials (SBOM) for prosjektet ved å analysere `pnpm-lock.yaml` og `package.json`-filene i arbeidsområdet.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const ROOT = process.cwd();
const LOCKFILE_PATH = join(ROOT, "pnpm-lock.yaml");
const OUTPUT_PATH = join(ROOT, "artifacts", "sbom", "studywise.cyclonedx.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function getSection(source, startName, endNames) {
  const start = source.indexOf(`${startName}:\n`);
  if (start === -1) {
    return "";
  }

  const rest = source.slice(start + startName.length + 2);
  const endIndexes = endNames
    .map((name) => rest.indexOf(`\n${name}:\n`))
    .filter((index) => index !== -1);
  const end = endIndexes.length > 0 ? Math.min(...endIndexes) : rest.length;
  return rest.slice(0, end);
}

function cleanYamlKey(rawKey) {
  return rawKey
    .trim()
    .replace(/:$/, "")
    .replace(/^['"]|['"]$/g, "");
}

function stripPeerSuffix(version) {
  return version.replace(/\(.*/, "");
}

function parsePackageKey(key) {
  const normalized = cleanYamlKey(key);
  const withoutPeerSuffix = stripPeerSuffix(normalized);
  const separator = withoutPeerSuffix.lastIndexOf("@");

  if (separator <= 0) {
    return null;
  }

  const name = withoutPeerSuffix.slice(0, separator);
  const version = withoutPeerSuffix.slice(separator + 1);

  if (!name || !version || version.startsWith("link:") || version.startsWith("workspace:")) {
    return null;
  }

  return { name, version };
}

function purlFor(name, version) {
  const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function bomRefFor(name, version) {
  return purlFor(name, version);
}

function integrityToHash(integrity) {
  const match = integrity.match(/sha(256|384|512)-([^,\s}]+)/);
  if (!match) {
    return null;
  }

  return {
    alg: `SHA-${match[1]}`,
    content: Buffer.from(match[2], "base64").toString("hex"),
  };
}

function addComponent(componentsByRef, { name, version, integrity, scope }) {
  const bomRef = bomRefFor(name, version);
  const component = componentsByRef.get(bomRef) ?? {
    type: "library",
    "bom-ref": bomRef,
    name,
    version,
    purl: purlFor(name, version),
  };

  if (scope && !component.scope) {
    component.scope = scope;
  }

  const hash = integrity ? integrityToHash(integrity) : null;
  if (hash && !component.hashes) {
    component.hashes = [hash];
  }

  componentsByRef.set(bomRef, component);
}

function collectWorkspaceComponents(componentsByRef) {
  for (const packagePath of [
    "package.json",
    "backend/package.json",
    "common/package.json",
    "docs/package.json",
    "frontend/package.json",
    "tests/package.json",
  ]) {
    const manifest = readJson(join(ROOT, packagePath));
    addComponent(componentsByRef, {
      name: manifest.name || basename(dirname(packagePath)),
      version: manifest.version || "0.0.0",
      scope: "required",
    });
  }
}

function collectLockfileComponents(componentsByRef, lockfileSource) {
  const packagesSection = getSection(lockfileSource, "packages", ["snapshots"]);
  const packageBlocks = [];
  let currentKey = null;
  let currentBlock = [];

  for (const line of packagesSection.split(/\r?\n/)) {
    const packageHeader = line.match(/^  (\S.*):\s*$/);
    if (packageHeader) {
      if (currentKey) {
        packageBlocks.push([currentKey, currentBlock.join("\n")]);
      }

      currentKey = packageHeader[1];
      currentBlock = [];
      continue;
    }

    if (currentKey) {
      currentBlock.push(line);
    }
  }

  if (currentKey) {
    packageBlocks.push([currentKey, currentBlock.join("\n")]);
  }

  for (const [key, block] of packageBlocks) {
    const parsed = parsePackageKey(key);
    if (!parsed) {
      continue;
    }

    const integrity = block.match(/integrity:\s*([^}\n]+)/)?.[1]?.trim();
    addComponent(componentsByRef, {
      ...parsed,
      integrity,
      scope: "required",
    });
  }
}

function buildBom() {
  const rootManifest = readJson(join(ROOT, "package.json"));
  const lockfileSource = readFileSync(LOCKFILE_PATH, "utf8");
  const lockfileHash = createHash("sha256").update(lockfileSource).digest("hex");
  const componentsByRef = new Map();

  collectWorkspaceComponents(componentsByRef);
  collectLockfileComponents(componentsByRef, lockfileSource);

  const components = [...componentsByRef.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [
          {
            type: "application",
            name: "studywise-sbom-generator",
            version: "1.0.0",
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": "studywise",
        name: rootManifest.name,
        version: rootManifest.version || "0.0.0",
      },
      properties: [
        {
          name: "studywise:pnpm-lock-sha256",
          value: lockfileHash,
        },
      ],
    },
    components,
  };
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(buildBom(), null, 2)}\n`);
console.log(`Wrote CycloneDX SBOM to ${OUTPUT_PATH}`);

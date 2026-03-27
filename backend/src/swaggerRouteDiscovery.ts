/**
 * Swagger route discovery.
 *
 * Parser backend sitt `index.ts`/router-oppsett for å finne Express-ruter og bygge Swagger paths.
 * Brukes for å holde dokumentasjonen i sync uten manuell duplisering.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicApiPath } from "./utils/publicApiPaths.js";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type SwaggerSchema = Record<string, unknown>;
type SwaggerResponses = Record<string, SwaggerSchema>;
type SwaggerParameters = Array<Record<string, unknown>>;
type SwaggerOperation = Record<string, unknown>;
type SwaggerPathItem = Partial<Record<HttpMethod, SwaggerOperation>>;
export type SwaggerPaths = Record<string, SwaggerPathItem>;

interface ImportBinding {
  filePath: string;
  routerName: string;
}

interface DiscoveredRoute {
  method: HttpMethod;
  path: string;
  tag: string;
  filePath: string;
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];
const ROUTER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "rutere",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRouteFile(filePath: string): boolean {
  return normalizeSlashes(filePath).startsWith(normalizeSlashes(ROUTER_ROOT));
}

function joinPaths(prefix: string, routePath: string): string {
  const raw = `${prefix}/${routePath}`.replace(/\/+/g, "/");
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized !== "/" && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function toOpenApiPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function buildOperationId(method: HttpMethod, routePath: string): string {
  return `${method}_${routePath}`
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function inferTag(filePath: string): string {
  const normalized = normalizeSlashes(filePath);
  if (normalized.includes("/rutere/canvas/")) return "Canvas";
  if (normalized.includes("/rutere/ki/")) return "KI";
  if (normalized.includes("/rutere/auth/")) return "Bruker";
  if (normalized.includes("/rutere/arbeidsplan/")) return "Arbeidsplan";
  if (normalized.includes("/rutere/quiz/")) return "Quiz";
  if (normalized.includes("/rutere/flashcards/")) return "Flashcards";
  if (normalized.includes("/rutere/roller/admin/")) return "Admin";
  if (normalized.includes("/rutere/debug/")) return "Debug";
  return "API";
}

function resolveImportPath(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null;

  const withoutJsExtension = importPath.replace(/\.js$/u, ".ts");
  const resolved = path.resolve(path.dirname(fromFile), withoutJsExtension);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolved bygges kun fra relative imports i repoets egne route-filer
  return fs.existsSync(resolved) ? resolved : null;
}

function parseImports(source: string, fromFile: string): Map<string, ImportBinding> {
  const importMap = new Map<string, ImportBinding>();
  const importRegex = /import\s+([\s\S]*?)\s+from\s+["'](.+?)["'];/g;

  for (const match of source.matchAll(importRegex)) {
    const clause = match[1]?.trim();
    const importPath = match[2]?.trim();
    if (!clause || !importPath) continue;

    const resolvedPath = resolveImportPath(fromFile, importPath);
    if (!resolvedPath || !isRouteFile(resolvedPath)) continue;

    const namedImportMatch = clause.match(/\{([\s\S]+)\}/u);
    if (namedImportMatch) {
      const namedImports = namedImportMatch[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      for (const namedImport of namedImports) {
        const withoutType = namedImport.replace(/^type\s+/u, "").trim();
        const [exportedName, alias] = withoutType
          .split(/\s+as\s+/u)
          .map((part) => part.trim());
        if (!exportedName) continue;
        importMap.set(alias || exportedName, {
          filePath: resolvedPath,
          routerName: exportedName,
        });
      }
    }

    const defaultClause = clause.replace(/\{[\s\S]+\}/u, "").replace(/,/g, "").trim();
    const defaultImport = defaultClause.replace(/^type\s+/u, "").trim();
    if (defaultImport) {
      importMap.set(defaultImport, {
        filePath: resolvedPath,
        routerName: "router",
      });
    }
  }

  return importMap;
}

function extractDirectRoutes(
  source: string,
  routerName: string,
  prefix: string,
  filePath: string,
): DiscoveredRoute[] {
  // eslint-disable-next-line security/detect-non-literal-regexp -- regexen bygges fra interne router-navn/metoder, ikke brukerinput
  const routeRegex = new RegExp(
    `${escapeRegExp(routerName)}\\.(${HTTP_METHODS.join("|")})\\(\\s*["'\`]([^"'\\\`]+)["'\`]`,
    "g",
  );

  return Array.from(source.matchAll(routeRegex)).map((match) => ({
    method: match[1] as HttpMethod,
    path: joinPaths(prefix, match[2]),
    tag: inferTag(filePath),
    filePath,
  }));
}

function extractMountedRouters(
  source: string,
  routerName: string,
): Array<{ prefix: string; importedRouterName: string }> {
  // eslint-disable-next-line security/detect-non-literal-regexp -- regexen bygges fra interne router-navn i backend-koden
  const mountRegex = new RegExp(
    `${escapeRegExp(routerName)}\\.use\\(\\s*["'\`]([^"'\\\`]+)["'\`][^;]*?,\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`,
    "g",
  );

  return Array.from(source.matchAll(mountRegex)).map((match) => ({
    prefix: match[1],
    importedRouterName: match[2],
  }));
}

function extractNestedRouters(
  source: string,
  routerName: string,
): Array<{ importedRouterName: string }> {
  // eslint-disable-next-line security/detect-non-literal-regexp -- regexen bygges fra interne router-navn i backend-koden
  const nestedRegex = new RegExp(
    `${escapeRegExp(routerName)}\\.use\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`,
    "g",
  );

  return Array.from(source.matchAll(nestedRegex)).map((match) => ({
    importedRouterName: match[1],
  }));
}

function discoverRoutesFromRouter(
  filePath: string,
  routerName: string,
  prefix: string,
  visited: Set<string>,
): DiscoveredRoute[] {
  const visitKey = `${filePath}:${routerName}:${prefix}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath er begrenset til backend/src/index.ts og route-filer under repoet
  const source = fs.readFileSync(filePath, "utf8");
  const imports = parseImports(source, filePath);
  const directRoutes = extractDirectRoutes(source, routerName, prefix, filePath);

  const nestedRoutes = extractNestedRouters(source, routerName).flatMap(({ importedRouterName }) => {
    const binding = imports.get(importedRouterName);
    if (!binding) return [];
    return discoverRoutesFromRouter(binding.filePath, binding.routerName, prefix, visited);
  });

  const mountedRoutes = extractMountedRouters(source, routerName).flatMap(
    ({ prefix: nestedPrefix, importedRouterName }) => {
      const binding = imports.get(importedRouterName);
      if (!binding) return [];
      return discoverRoutesFromRouter(
        binding.filePath,
        binding.routerName,
        joinPaths(prefix, nestedPrefix),
        visited,
      );
    },
  );

  return [...directRoutes, ...nestedRoutes, ...mountedRoutes];
}

function buildPathParameters(routePath: string): SwaggerParameters {
  const parameterMatches = routePath.match(/{([A-Za-z0-9_]+)}/g) ?? [];

  return parameterMatches.map((match) => {
    const name = match.slice(1, -1);
    return {
      name,
      in: "path",
      required: true,
      schema: {
        type: "string",
      },
      description: `Path-parameter: ${name}`,
    };
  });
}

function buildResponses(routePath: string): SwaggerResponses {
  if (routePath === "/health" || routePath === "/ready" || routePath === "/health/dependencies") {
    return {
      "200": {
        description: "Tjenestestatus hentet",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/HealthCheck",
            },
          },
        },
      },
    };
  }

  return {
    "200": {
      description: "Forespørselen ble håndtert",
    },
    "401": {
      description: "Autentisering kreves eller er ugyldig",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Error",
          },
        },
      },
    },
    "500": {
      description: "Intern serverfeil",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Error",
          },
        },
      },
    },
  };
}

function createOperation(route: DiscoveredRoute): SwaggerOperation {
  const openApiPath = toOpenApiPath(route.path);
  const parameters = buildPathParameters(openApiPath);
  const requiresAuth = route.path.startsWith("/api/") && !isPublicApiPath(route.path, route.method);

  return {
    operationId: buildOperationId(route.method, openApiPath),
    tags: [route.tag],
    summary: `${route.method.toUpperCase()} ${route.path}`,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
    responses: buildResponses(route.path),
  };
}

function dedupeRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method}:${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Oppdager Express-ruter og returnerer et Swagger `paths`-objekt.
 *
 * Dette er en best-effort parser (heuristikk) som forsøker å holde Swagger i sync med
 * faktisk router-oppsett uten å kreve manuell duplisering.
 */
export function discoverSwaggerPaths(): SwaggerPaths {
  const indexFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "index.ts");
  const discoveredRoutes = dedupeRoutes(
    discoverRoutesFromRouter(indexFilePath, "app", "", new Set<string>()),
  );

  return discoveredRoutes.reduce<SwaggerPaths>((paths, route) => {
    const openApiPath = toOpenApiPath(route.path);
    const existingPathItem = paths[openApiPath] ?? {};
    paths[openApiPath] = {
      ...existingPathItem,
      [route.method]: createOperation(route),
    };
    return paths;
  }, {});
}

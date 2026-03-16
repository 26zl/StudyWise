/**
 * WEB_ORIGINS (kommaseparert) brukes av CORS, CSRF og Clerk authorizedParties.
 * Én kilde for tillatte frontend-origins.
 * Resultatet caches ved første kall — WEB_ORIGINS endres ikke under kjøretid.
 */
export function normalizeWebOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin === "null") {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

let cachedResult: { origins: string[]; invalidEntries: string[] } | null = null;

function parseConfiguredWebOrigins(): {
  origins: string[];
  invalidEntries: string[];
} {
  if (cachedResult) return cachedResult;

  const origins: string[] = [];
  const invalidEntries: string[] = [];

  for (const rawValue of (process.env.WEB_ORIGINS ?? "").split(",")) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = normalizeWebOrigin(trimmed);
    if (normalized) {
      origins.push(normalized);
      continue;
    }

    invalidEntries.push(trimmed);
  }

  cachedResult = {
    origins: [...new Set(origins)],
    invalidEntries,
  };
  return cachedResult;
}

export function getConfiguredWebOrigins(): string[] {
  return parseConfiguredWebOrigins().origins;
}

export function getInvalidConfiguredWebOrigins(): string[] {
  return parseConfiguredWebOrigins().invalidEntries;
}

let cachedOriginSet: Set<string> | null = null;

export function getConfiguredWebOriginSet(): Set<string> {
  if (cachedOriginSet) return cachedOriginSet;
  cachedOriginSet = new Set(getConfiguredWebOrigins());
  return cachedOriginSet;
}

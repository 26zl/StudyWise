/**
 * WEB_ORIGINS (kommaseparert) brukes av CORS, CSRF og Clerk authorizedParties.
 * Én kilde for tillatte frontend-origins.
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

function parseConfiguredWebOrigins(): {
  origins: string[];
  invalidEntries: string[];
} {
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

  return {
    origins: [...new Set(origins)],
    invalidEntries,
  };
}

export function getConfiguredWebOrigins(): string[] {
  return parseConfiguredWebOrigins().origins;
}

export function getInvalidConfiguredWebOrigins(): string[] {
  return parseConfiguredWebOrigins().invalidEntries;
}

export function getConfiguredWebOriginSet(): Set<string> {
  return new Set(getConfiguredWebOrigins());
}

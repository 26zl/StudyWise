const DEFAULT_POST_AUTH_REDIRECT = "/dashboard";
const REDIRECT_BASE_ORIGIN = "https://studwize.page";

type SearchParamsLike =
  | {
      get(name: string): string | null;
    }
  | null
  | undefined;

type SearchStringLike =
  | {
      toString(): string;
    }
  | null
  | undefined;

function erAuthPath(pathname: string): boolean {
  return (
    pathname === "/auth/sign-in" ||
    pathname.startsWith("/auth/sign-in/") ||
    pathname === "/auth/sign-up" ||
    pathname.startsWith("/auth/sign-up/") ||
    pathname === "/auth/forgot-password" ||
    pathname.startsWith("/auth/forgot-password/") ||
    pathname === "/auth/tasks" ||
    pathname.startsWith("/auth/tasks/")
  );
}

export function resolveSafePostAuthRedirect(
  candidate: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_REDIRECT,
): string {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate.startsWith("/") || trimmedCandidate.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmedCandidate, REDIRECT_BASE_ORIGIN);
    if (parsed.origin !== REDIRECT_BASE_ORIGIN) {
      return fallback;
    }

    const normalizedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (erAuthPath(parsed.pathname)) {
      return fallback;
    }

    return normalizedPath;
  } catch {
    return fallback;
  }
}

export function getPostAuthRedirectFromParams(
  searchParams: SearchParamsLike,
  fallback = DEFAULT_POST_AUTH_REDIRECT,
): string {
  return resolveSafePostAuthRedirect(searchParams?.get("redirect_url"), fallback);
}

export function buildPostAuthRedirect(
  pathname: string | null | undefined,
  searchParams: SearchStringLike,
  fallback = DEFAULT_POST_AUTH_REDIRECT,
): string {
  const safePath =
    typeof pathname === "string" && pathname.startsWith("/") && !pathname.startsWith("//")
      ? pathname
      : fallback;
  const searchString = searchParams?.toString().trim();
  const candidate = searchString ? `${safePath}?${searchString}` : safePath;

  return resolveSafePostAuthRedirect(candidate, fallback);
}

export function withPostAuthRedirect(
  path: string,
  redirectUrl: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_REDIRECT,
): string {
  const url = new URL(path, REDIRECT_BASE_ORIGIN);
  const safeRedirect = resolveSafePostAuthRedirect(redirectUrl, fallback);

  if (safeRedirect === fallback) {
    url.searchParams.delete("redirect_url");
  } else {
    url.searchParams.set("redirect_url", safeRedirect);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Legger til en query-parameter på en relativ path som allerede kan ha ?-parametre.
 * Unngår dobbel-? ved å bruke URL API.
 */
export function appendQueryParam(path: string, key: string, value: string): string {
  const url = new URL(path, REDIRECT_BASE_ORIGIN);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export { DEFAULT_POST_AUTH_REDIRECT };

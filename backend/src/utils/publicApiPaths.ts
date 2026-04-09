const PUBLIC_GET_ONLY_PATHS = [
  "/api/ki/share",
  "/api/user/username/check",
] as const;
const PUBLIC_ALL_METHOD_PATHS = ["/api/kontakt"] as const;

function matchesExactOrChildPath(path: string, publicPath: string): boolean {
  return path === publicPath || path.startsWith(`${publicPath}/`);
}

export function isPublicApiPath(path: string, method?: string): boolean {
  if (PUBLIC_ALL_METHOD_PATHS.some((publicPath) => matchesExactOrChildPath(path, publicPath))) {
    return true;
  }

  const normalizedMethod = method?.toUpperCase();
  if (normalizedMethod && normalizedMethod !== "GET") {
    return false;
  }

  return PUBLIC_GET_ONLY_PATHS.some((publicPath) => matchesExactOrChildPath(path, publicPath));
}

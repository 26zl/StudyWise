/**
 * Delt regex-verktøy for backend.
 */

/** Escaper spesialtegn i en streng for bruk i RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

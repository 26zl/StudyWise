/**
 * Delte kryptografiske hjelpefunksjoner.
 * Brukes av brukerAuth (Canvas token hashing) og clerkAuth (token cache).
 */
import crypto from "crypto";

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

/** SHA-256 hash av en streng, returnert som hex. */
export function hashSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Sjekker om en streng er et gyldig SHA-256 hex-hash. */
export function isValidSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256_HEX_REGEX.test(value);
}

/** Timing-safe sammenligning av to SHA-256 hex-hashes. */
export function timingSafeHexEqual(
  storedHash: string | null | undefined,
  candidateHash: string,
): boolean {
  const aValid = isValidSha256Hex(storedHash);
  const bValid = isValidSha256Hex(candidateHash);
  const a = aValid ? storedHash : "0".repeat(64);
  const b = bValid ? candidateHash : "1".repeat(64);

  const equal = crypto.timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex"),
  );
  return equal && aValid && bValid;
}

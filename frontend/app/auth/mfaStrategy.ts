/**
 * Auto-deteksjon av second-factor-strategi basert på input-format.
 *
 * Clerk støtter to strategier ved second-factor-verifisering:
 *   - `totp`        — 6-sifret kode generert av autentikator-app
 *   - `backup_code` — alfanumerisk engangs-kode (10 tegn) generert av Clerk
 *                     når brukeren skrur på backup codes i sin profil
 *
 * UI-en bruker ett enkelt input-felt for begge typene slik at brukeren ikke
 * trenger å bytte modus før de skriver. Vi normaliserer ved å fjerne mellomrom
 * og bindestreker (Clerk viser backup codes med format "abcde-fghij" for
 * lesbarhet — pasten kan ha med eller uten dash).
 *
 * Klasifiseringen er strikt: kun nøyaktig 6 sifre regnes som TOTP. Alt annet
 * sendes som backup_code, hvor Clerk gjør sin egen valideringsmatch og
 * returnerer en tydelig feil hvis koden ikke finnes.
 */
export type SecondFactorAttempt =
  | { strategy: "totp"; code: string }
  | { strategy: "backup_code"; code: string };

export function detectSecondFactorStrategy(rawInput: string): SecondFactorAttempt | null {
  const sanitized = rawInput.replace(/[\s-]/g, "");
  if (!sanitized) return null;
  if (/^\d{6}$/.test(sanitized)) {
    return { strategy: "totp", code: sanitized };
  }
  return { strategy: "backup_code", code: sanitized };
}

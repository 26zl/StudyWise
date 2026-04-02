import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Playwright globalSetup-funksjon — kjøres én gang før alle tester.
 * Henter et Clerk Testing Token som omgår Turnstile.
 */
export default async function globalSetup() {
  await clerkSetup();
}

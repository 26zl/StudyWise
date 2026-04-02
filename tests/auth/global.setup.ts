import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Playwright globalSetup function — runs once before any tests.
 * Obtains a Clerk Testing Token that bypasses Turnstile.
 */
export default async function globalSetup() {
  await clerkSetup();
}

/*
 * Next.js proxy – Clerk auth + nonce-basert CSP.
 * Next.js 16: proxy erstatter middleware (samme formål, ny filkonvensjon).
 * Clerk: https://clerk.com/docs/nextjs/getting-started/quickstart
 *
 * Offentlige ruter kjører middleware uten auth-sjekk (raskere).
 * Beskyttede ruter krever innlogging — Clerk redirecter automatisk.
 *
 * CSP-nonce genereres per request og injiseres i response-headere.
 * Layout leser nonce fra x-nonce request-header via headers().
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildCspValue } from "./next.config.js";

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
  undefined;

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/oversikt(.*)",
  "/ai-breakdown(.*)",
  "/account(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  // Generer kryptografisk nonce for CSP per request
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const cspValue = buildCspValue(nonce);

  // Sett nonce på request-header slik at layout.tsx kan lese den via headers()
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", cspValue);

  return response;
}, {
  publishableKey: clerkPublishableKey,
  signInUrl: "/auth/sign-in",
  signUpUrl: "/auth/sign-up",
});

export const config = {
  matcher: [
    // Clerk middleware kjører kun på sider, IKKE på /api/*, statiske filer, eller _next
    "/((?!_next|api|health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};

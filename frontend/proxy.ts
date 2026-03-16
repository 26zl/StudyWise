/*
 * Next.js proxy – Clerk auth.
 * Next.js 16: proxy erstatter middleware (samme formål, ny filkonvensjon).
 * Clerk: https://clerk.com/docs/nextjs/getting-started/quickstart
 *
 * Offentlige ruter kjører middleware uten auth-sjekk (raskere).
 * Beskyttede ruter krever innlogging — Clerk redirecter automatisk.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
  undefined;

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/oversikt(.*)",
  "/ai-breakdown(.*)",
  "/profil(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
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

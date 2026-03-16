/*
 * Next.js proxy – Clerk auth.
 * Next.js 16: proxy erstatter middleware (samme formål, ny filkonvensjon).
 * Clerk: https://clerk.com/docs/nextjs/getting-started/quickstart
 */
import { clerkMiddleware } from "@clerk/nextjs/server";

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
  undefined;

export default clerkMiddleware({
  publishableKey: clerkPublishableKey,
});

export const config = {
  matcher: [
    // Clerk middleware kjører kun på sider, IKKE på /api/* (de proxies direkte til backend som håndterer sin egen auth)
    "/((?!_next|api|health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};

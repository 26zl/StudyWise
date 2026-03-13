/*
 * Next.js proxy – Clerk auth.
 * Next.js 16: proxy erstatter middleware (samme formål, ny filkonvensjon).
 * Clerk: https://clerk.com/docs/nextjs/getting-started/quickstart
 */
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

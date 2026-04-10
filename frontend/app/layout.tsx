/*
 * Root layout – én felles shell for hele appen (Next.js standard oppsett).
 * Clerk, tema, Providers, Header, Toaster osv. omslutter alle ruter.
 */
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};
import { ThemeProvider } from "@/app/components/ui/theme-provider";
import { getFrontendClerkPublishableKey, validateFrontendEnv } from "./lib/validateEnv";
import { MainAppShell } from "@/app/components/layout/MainAppShell";
import {
  getPreferredLanguageFromAcceptLanguage,
  isLanguage,
  LANGUAGE_COOKIE_KEY,
} from "@/app/i18n/core";
import type { Language } from "@/app/i18n/types";

validateFrontendEnv();
const clerkPublishableKey = getFrontendClerkPublishableKey();

async function resolveInitialLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLanguage = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;

  if (isLanguage(cookieLanguage)) {
    return cookieLanguage;
  }

  return getPreferredLanguageFromAcceptLanguage(headerStore.get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await resolveInitialLanguage();

  return {
    title: "StudyWise",
    description:
      language === "en"
        ? "AI-powered study assistant with Canvas LMS integration"
        : "KI-drevet studieassistent med Canvas LMS-integrasjon",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "StudyWise",
    },
    icons: {
      icon: [
        {
          url: "/icons/icon-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: "/icons/icon-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [initialLanguage, headerStore] = await Promise.all([
    resolveInitialLanguage(),
    headers(),
  ]);
  const nonce = headerStore.get("x-nonce") ?? undefined;

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://clerk.studwize.page" />
        <link rel="dns-prefetch" href="https://clerk.studwize.page" />
      </head>
      <body className="antialiased min-h-dvh flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <MainAppShell
            clerkPublishableKey={clerkPublishableKey}
            initialLanguage={initialLanguage}
            nonce={nonce}
          >
            {children}
          </MainAppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}

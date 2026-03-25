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
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const initialLanguage = await resolveInitialLanguage();
  const rumApplicationId =
    process.env.DD_RUM_APPLICATION_ID ?? process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID ?? "6d1263e0-6ea4-452d-bd26-a3b1edd2264c";
  const rumClientToken =
    process.env.DD_RUM_CLIENT_TOKEN ?? process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN ?? "pube24e48923b7366b68136b3fefed2837b";
  const rumConfig =
    rumApplicationId && rumClientToken
      ? {
          applicationId: rumApplicationId,
          clientToken: rumClientToken,
          site: process.env.DD_SITE ?? process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com",
        }
      : null;

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://clerk.studwize.page" />
        <link rel="dns-prefetch" href="https://clerk.studwize.page" />
        {rumConfig && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__DD_RUM_CONFIG__=${JSON.stringify(rumConfig)};`,
            }}
          />
        )}
        {/*
          Suppress kjent Clerk v7 key-prop warning: "Each child in a list should have a unique key prop"
          fra __experimental_CheckoutProvider. Dette er en intern Clerk-bug i @clerk/nextjs v7 med React 19.
          Feilen kommer IKKE fra vår kode — den trigges av ClerkProvider sin interne rendering.
          Kan trygt ignoreres. Fjern dette scriptet når Clerk fikser det i en fremtidig versjon.
          Se: https://github.com/clerk/javascript/issues
        */}
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var originalError=console.error;console.error=function(){try{var args=Array.prototype.slice.call(arguments);var joined=args.map(function(arg){return typeof arg==="string"?arg:"";}).join(" ");var isClerkCheckoutKeyWarning=joined.indexOf('Each child in a list should have a unique "key" prop')!==-1&&joined.indexOf("__experimental_CheckoutProvider")!==-1;if(isClerkCheckoutKeyWarning)return;}catch(_error){}originalError.apply(console,arguments);};})();`,
            }}
          />
        )}
      </head>
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <MainAppShell
            clerkPublishableKey={clerkPublishableKey}
            initialLanguage={initialLanguage}
          >
            {children}
          </MainAppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}

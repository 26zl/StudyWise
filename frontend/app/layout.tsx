/*
 * Root layout – én felles shell for hele appen (Next.js standard oppsett).
 * Clerk, tema, Providers, Header, Toaster osv. omslutter alle ruter.
 */
import type { Metadata, Viewport } from "next";
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
import { ClerkProvider } from "@clerk/nextjs";
import { nbNO } from "@clerk/localizations";
import { ThemeProvider } from "@/app/components/ui/theme-provider";
import { getFrontendClerkPublishableKey, validateFrontendEnv } from "./lib/validateEnv";
import { MainAppShell } from "@/app/components/layout/MainAppShell";

validateFrontendEnv();
const clerkPublishableKey = getFrontendClerkPublishableKey();

export const metadata: Metadata = {
  title: "StudyWise",
  description: "KI-drevet studieassistent med Canvas LMS-integrasjon",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StudyWise",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const rumApplicationId =
    process.env.DD_RUM_APPLICATION_ID ?? process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
  const rumClientToken =
    process.env.DD_RUM_CLIENT_TOKEN ?? process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
  const rumConfig =
    rumApplicationId && rumClientToken
      ? {
          applicationId: rumApplicationId,
          clientToken: rumClientToken,
          site: process.env.DD_SITE ?? process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com",
        }
      : null;

  return (
    <html lang="nb" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://clerk.studwize.page" />
        <link rel="dns-prefetch" href="https://clerk.studwize.page" />
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
              __html: `(function(){var o=console.error;console.error=function(){if(typeof arguments[0]==="string"&&arguments[0].indexOf("__experimental_CheckoutProvider")!==-1)return;o.apply(console,arguments)};})();`,
            }}
          />
        )}
      </head>
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        <ClerkProvider
          publishableKey={clerkPublishableKey ?? undefined}
          localization={nbNO}
          signInUrl="/auth/sign-in"
          signUpUrl="/auth/sign-up"
          dynamic
        >
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {rumConfig && (
              <script
                dangerouslySetInnerHTML={{
                  __html: `window.__DD_RUM_CONFIG__=${JSON.stringify(rumConfig)};`,
                }}
              />
            )}
            <MainAppShell>{children}</MainAppShell>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

/*
* Layout komponent for Next.js applikasjonen
* Inkluderer globale metadata og CSS
* Integrerer Providers for global state management
*/

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "./components/header";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/Toaster";
import { getLayoutAuth } from "./auth/auth-server";
import { validateFrontendEnv } from "./lib/validateEnv";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DatadogRum } from "./components/DatadogRum";

// Valider miljøvariabler ved oppstart (server-side)
validateFrontendEnv();

// Metadata for applikasjonen
export const metadata: Metadata = {
  title: "StudyWise",
  description: "Bacheloroppgave i IT ved USN 2026",
};
// RootLayout er hovedlayouten for applikasjonen
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, hadCookies } = await getLayoutAuth();

  // RUM-config fra server (runtime) — slik at Vercel env uten NEXT_PUBLIC_ fungerer uten ny build
  const rumApplicationId = process.env.DD_RUM_APPLICATION_ID ?? process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
  const rumClientToken = process.env.DD_RUM_CLIENT_TOKEN ?? process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
  const rumConfig =
    rumApplicationId && rumClientToken
      ? {
          applicationId: rumApplicationId,
          clientToken: rumClientToken,
          site: process.env.DD_RUM_SITE ?? process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com",
        }
      : null;

  return (
    <html lang="nb" suppressHydrationWarning>
      {/*
        Dette er "rammen" rundt hele applikasjonen.
        Den definerer <body> og globale verktøy (Providers).
      */}
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        {rumConfig && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__DD_RUM_CONFIG__=${JSON.stringify(rumConfig)};`,
            }}
          />
        )}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Providers pakker inn alt innhold slik at funksjonalitet som data-fetching virker overalt */}
          <Providers>
            <div className="flex flex-col min-h-screen">
              <Header user={user} hadCookies={hadCookies} />
              {/*
                {children} er selve innholdet fra page.tsx.
                Når du bytter side, er det bare denne delen som byttes ut.
              */}
              <main className="flex-1 min-h-0 relative flex flex-col">
                {children}
              </main>
            </div>
            <Toaster />
            <SpeedInsights />
            <DatadogRum />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

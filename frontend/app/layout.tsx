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
import { getUserServerSafe } from "./auth/auth-server";
import { validateFrontendEnv } from "./lib/validateEnv";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
  const user = await getUserServerSafe();
  // Layout komponenten returnerer HTML-strukturen for applikasjonen
  return (
    <html lang="nb" suppressHydrationWarning>
      {/*
        Dette er "rammen" rundt hele applikasjonen.
        Den definerer <body> og globale verktøy (Providers).
      */}
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Providers pakker inn alt innhold slik at funksjonalitet som data-fetching virker overalt */}
          <Providers>
            <div className="flex flex-col min-h-screen">
              <Header user={user} />
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
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

/*
* Layout komponent for Next.js applikasjonen
* Inkluderer globale metadata og CSS
* Integrerer Providers for global state management
*/

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "./components/header";

export const metadata: Metadata = {
  title: "StudyWise",
  description: "Bacheloroppgave i IT ved USN 2026",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nb" suppressHydrationWarning>
      {/*
        Dette er "rammen" rundt hele applikasjonen.
        Den definerer <body> og globale verktøy (Providers).
      */}
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        {/* Providers pakker inn alt innhold slik at funksjonalitet som data-fetching virker overalt */}
        <Providers>
          <div className="flex flex-col min-h-screen">
            <Header />
            {/*
              {children} er selve innholdet fra page.tsx.
              Når du bytter side, er det bare denne delen som byttes ut.
            */}
            <main className="flex-1 min-h-0 relative flex flex-col">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

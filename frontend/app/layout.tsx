/*
* Layout komponent for Next.js applikasjonen
* Inkluderer globale metadata og CSS
* Integrerer Providers for global state management
*/

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "./components/header";
import { Footer } from "./components/footer";

export const metadata: Metadata = {
  title: "Bachelor IT - USN",
  description: "Studentprosjekt",
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
      <body className="antialiased h-full flex flex-col" suppressHydrationWarning>
        {/* Providers pakker inn alt innhold slik at funksjonalitet som data-fetching virker overalt */}
        <Providers>
          <Header />
          {/*
            {children} er selve innholdet fra page.tsx.
            Når du bytter side, er det bare denne delen som byttes ut.
          */}
          <main className="flex-1 relative">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

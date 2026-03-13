/*
* Layout komponent for Next.js applikasjonen
* Inkluderer globale metadata og CSS
* Holder kun global auth/theme-ramme; app-shell for ikke-auth ligger i route group layout
* Clerk brukes som eneste identitetsleverandør for innlogging, profil og sesjon.
*/

import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { nbNO } from "@clerk/localizations";
import { ThemeProvider } from "./components/theme-provider";
import { validateFrontendEnv } from "./lib/validateEnv";

// Valider miljøvariabler ved oppstart (server-side)
validateFrontendEnv();

// Metadata for applikasjonen
export const metadata: Metadata = {
  title: "StudyWise",
  description: "Bacheloroppgave i IT ved USN 2026",
};
// RootLayout er hovedlayouten for applikasjonen
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nb" suppressHydrationWarning>
      {/* 
        Dette er "rammen" rundt hele applikasjonen.
        Den definerer <body> og global Clerk/tema-kontekst.
      */}
      <body className="antialiased min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" suppressHydrationWarning>
        <ClerkProvider
          localization={nbNO}
          signInUrl="/auth/sign-in"
          signUpUrl="/auth/sign-up"
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

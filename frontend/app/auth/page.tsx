/*
 * Innlogging og registrering
 * Hovedkomponent for autentiseringsside med skjemaer og tilstandshåndtering
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Footer } from "../components/footer";
import { useLoggInn, useRegistrer, useMeg } from "./auth-api";
import { broadcastLogin } from "../hooks/use-auth-sync";

// Modus for siden: innlogging eller registrering
type Modus = "login" | "register";

// Hovedkomponent for autentiseringsside
export default function AuthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const megQuery = useMeg();
  const loggInn = useLoggInn();
  const registrer = useRegistrer();
  // State for modus, skjema-felt og meldinger
  const [modus, settModus] = useState<Modus>("login");
  const [email, settEmail] = useState("");
  const [password, settPassword] = useState("");
  const [firstName, settFirstName] = useState("");
  const [lastName, settLastName] = useState("");
  const [feil, settFeil] = useState<string | null>(null);
  const [melding, settMelding] = useState<string | null>(null);

  // Håndter innlogging ved lasting av siden
  useEffect(() => {
    if (megQuery.data?.user) {
      router.replace("/dashboard");
    }
  }, [megQuery.data, router]);

  const venterPaMeg = megQuery.isLoading || megQuery.isFetching;
  // Hindre "flicker" av login-skjema hvis vi venter på data eller allerede er innlogget
  if (venterPaMeg || megQuery.data?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  // Nullstill meldinger
  const nullstillMeldinger = () => {
    settFeil(null);
    settMelding(null);
  };
  // Håndter skjema-innsending
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    nullstillMeldinger();
    // Validering for registrering
    try {
      if (modus === "login") {
        const data = await loggInn.mutateAsync({ email, password });
        queryClient.setQueryData(["auth", "me"], { user: data.user });
        broadcastLogin(); // Varsle andre faner om innlogging
        router.replace("/dashboard");
        return;
      }
      await registrer.mutateAsync({
        email,
        password,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      });
      settMelding("Bruker opprettet. Du kan nå logge inn.");
      settModus("login");
    } catch (err) {
      // Lag brukervennlig feilmelding
      const errorMsg = err instanceof Error ? err.message : "";
      let feilTekst: string;
      
      if (errorMsg.includes("401") || errorMsg.includes("feil passord") || errorMsg.includes("Unauthorized")) {
        feilTekst = "Feil e-post eller passord. Sjekk at du har skrevet riktig.";
      } else if (errorMsg.includes("404") || errorMsg.includes("finnes ikke") || errorMsg.includes("not found")) {
        feilTekst = "Ingen bruker med denne e-postadressen. Opprett en konto først.";
      } else if (errorMsg.includes("409") || errorMsg.includes("finnes allerede") || errorMsg.includes("eksisterer")) {
        feilTekst = "En bruker med denne e-postadressen finnes allerede. Prøv å logge inn.";
      } else if (errorMsg.includes("429") || errorMsg.includes("rate")) {
        feilTekst = "For mange forsøk. Vent noen minutter og prøv igjen.";
      } else if (errorMsg.includes("Nettverk") || errorMsg.includes("fetch") || errorMsg.includes("network")) {
        feilTekst = "Nettverksfeil. Sjekk internettforbindelsen din.";
      } else if (errorMsg.includes("passord") && errorMsg.includes("kort")) {
        feilTekst = "Passordet er for kort. Bruk minst 6 tegn.";
      } else if (errorMsg.includes("e-post") || errorMsg.includes("email")) {
        feilTekst = "Ugyldig e-postadresse eller passord. Sjekk at formatet er riktig.";
      } else {
        feilTekst = errorMsg || "Noe gikk galt. Prøv igjen.";
      }
      
      settFeil(feilTekst);
    }
  };
  // Indikator for lasting
  const laster = loggInn.isPending || registrer.isPending;

  // Render komponent
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      <div className="flex-1 flex items-center justify-center p-4">
        <main className="flex flex-col gap-6 p-8 max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg border dark:border-gray-800">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-black dark:text-white">
              {modus === "login" ? "Innlogging" : "Registrering"}
            </h1>
            <p className="text-zinc-600 dark:text-gray-400">
              Logg inn for å bruke Canvas og KI-funksjoner.
            </p>
          </div>

          <div className="flex gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => {
                nullstillMeldinger();
                settModus("login");
              }}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${modus === "login"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                : "text-slate-500 dark:text-slate-300"
                }`}
            >
              Logg inn
            </button>
            <button
              type="button"
              onClick={() => {
                nullstillMeldinger();
                settModus("register");
              }}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${modus === "register"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                : "text-slate-500 dark:text-slate-300"
                }`}
            >
              Registrer
            </button>
          </div>

          {feil && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {feil}
            </div>
          )}
          {melding && (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {melding}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                E-post
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => settEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder="ola@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Passord
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => settPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder={modus === "register" ? "Minimum 8 tegn" : "Ditt passord"}
              />
            </div>

            {modus === "register" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Fornavn
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => settFirstName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Etternavn
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => settLastName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={laster}
              className="w-full px-6 py-3 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-60 text-white rounded-lg font-semibold transition-colors"
            >
              {laster
                ? "Vennligst vent..."
                : modus === "login"
                  ? "Logg inn"
                  : "Opprett bruker"}
            </button>
          </form>
        </main>
      </div>
      <Footer />
    </div>
  );
}
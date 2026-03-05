/*
 * AuthPage – innlogging og registrering
 *
 * Bruker react-hook-form med zodResolver. Validering skjer mot skjemaer fra common/auth
 * (LoginRequestSchema ved innlogging, RegisterRequestSchema ved registrering).
 * Feltvis feil vises under input, og serverfeil mappes til brukervennlige meldinger.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type RegisterRequest,
} from "common/auth";
import { Footer } from "../components/footer";
import { useLoggInn, useRegistrer, useMeg } from "./auth-api";
import { broadcastLogin } from "../hooks/use-auth-sync";

/** Om bruker er på innlogging- eller registreringsskjema */
type Modus = "login" | "register";

/**
 * Skjema for innlogging: kun email + passord (fra common).
 * Utvidet med valgfrie firstName/lastName slik at skjemaet har samme feltstruktur
 * uansett modus, men kun de nødvendige valideres ved login.
 */
const loginFormSchema = LoginRequestSchema.extend({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

/** Startverdier for skjemaet (tomme felt) */
const defaultValues: RegisterRequest = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
};

export default function AuthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const megQuery = useMeg();
  const loggInn = useLoggInn();
  const registrer = useRegistrer();

  /** Om vi viser innlogging eller registrering */
  const [modus, settModus] = useState<Modus>("login");
  /** Generell feilmelding (f.eks. fra API) */
  const [feil, settFeil] = useState<string | null>(null);
  /** Suksessmelding (f.eks. etter registrering) */
  const [melding, settMelding] = useState<string | null>(null);

  /** Valideringsskjema avhenger av modus: login krever kun email+passord, register også min. 8 tegn passord */
  const schema = useMemo(
    () => (modus === "login" ? loginFormSchema : RegisterRequestSchema),
    [modus]
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<RegisterRequest>({
    defaultValues,
    resolver: zodResolver(schema),
    mode: "onTouched", // Valider felt første gang bruker har «touched» det
  });

  /** Redirect til dashboard hvis bruker allerede er innlogget */
  useEffect(() => {
    if (megQuery.data?.user) {
      router.replace("/dashboard");
    }
  }, [megQuery.data, router]);

  const venterPaMeg = megQuery.isLoading || megQuery.isFetching;
  if (venterPaMeg || megQuery.data?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const nullstillMeldinger = () => {
    settFeil(null);
    settMelding(null);
  };

  /**
   * Kalles når skjemaet er gyldig (zod har validert).
   * Logger inn eller oppretter bruker avhengig av modus, og håndterer API-feil
   * med brukervennlige meldinger (og feltvis setError der det passer).
   */
  const onValid = async (data: RegisterRequest) => {
    nullstillMeldinger();
    try {
      if (modus === "login") {
        const res = await loggInn.mutateAsync({ email: data.email, password: data.password });
        queryClient.setQueryData(["auth", "me"], { user: res.user });
        broadcastLogin(); // Varsle andre faner om innlogging
        router.replace("/dashboard");
        return;
      }
      await registrer.mutateAsync({
        email: data.email,
        password: data.password,
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
      });
      settMelding("Bruker opprettet. Du kan nå logge inn.");
      settModus("login");
      reset(defaultValues);
    } catch (err) {
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
        setError("password", { type: "server", message: feilTekst });
        return;
      } else if (errorMsg.includes("e-post") || errorMsg.includes("email")) {
        feilTekst = "Ugyldig e-postadresse eller passord. Sjekk at formatet er riktig.";
        setError("email", { type: "server", message: feilTekst });
        return;
      } else {
        feilTekst = errorMsg || "Noe gikk galt. Prøv igjen.";
      }
      settFeil(feilTekst);
    }
  };

  const laster = loggInn.isPending || registrer.isPending;

  /* Felles styling for input og feiltekst (gjenbrukt i skjemaet) */
  const inputClass =
    "w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm";
  const errorClass = "text-sm text-red-600 dark:text-red-400 mt-0.5";

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      <div className="flex-1 flex items-center justify-center p-4">
        <main className="flex flex-col gap-6 p-8 max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg border dark:border-gray-800">
          {/* Sidetittel og beskrivelse */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-black dark:text-white">
              {modus === "login" ? "Innlogging" : "Registrering"}
            </h1>
            <p className="text-zinc-600 dark:text-gray-400">
              Logg inn for å bruke Canvas og KI-funksjoner.
            </p>
          </div>

          {/* Tabs: Logg inn / Registrer */}
          <div className="flex gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => {
                nullstillMeldinger();
                settModus("login");
              }}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                modus === "login"
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
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                modus === "register"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  : "text-slate-500 dark:text-slate-300"
              }`}
            >
              Registrer
            </button>
          </div>

          {/* Feilmelding fra API (generell) */}
          {feil && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {feil}
            </div>
          )}
          {/* Suksessmelding (f.eks. etter registrering) */}
          {melding && (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {melding}
            </div>
          )}

          {/* Skjema: e-post og passord alltid, fornavn/etternavn kun ved registrering */}
          <form onSubmit={handleSubmit(onValid)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="auth-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                E-post
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder="ola@example.com"
                className={inputClass}
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              {errors.email && <p className={errorClass}>{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="auth-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Passord
              </label>
              <input
                id="auth-password"
                type="password"
                autoComplete={modus === "login" ? "current-password" : "new-password"}
                placeholder={modus === "register" ? "Minimum 8 tegn" : "Ditt passord"}
                className={inputClass}
                aria-invalid={!!errors.password}
                {...register("password")}
              />
              {errors.password && <p className={errorClass}>{errors.password.message}</p>}
            </div>

            {/* Fornavn/etternavn vises kun i registreringsmodus */}
            {modus === "register" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="auth-firstName" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Fornavn
                  </label>
                  <input
                    id="auth-firstName"
                    type="text"
                    autoComplete="given-name"
                    className={inputClass}
                    {...register("firstName")}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="auth-lastName" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Etternavn
                  </label>
                  <input
                    id="auth-lastName"
                    type="text"
                    autoComplete="family-name"
                    className={inputClass}
                    {...register("lastName")}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={laster || isSubmitting}
              className="w-full px-6 py-3 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-60 text-white rounded-lg font-semibold transition-colors"
            >
              {laster || isSubmitting
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

"use client";

/**
 * Kontaktskjema-komponent
 * Bruker react-hook-form, Zod-validering og Cloudflare Turnstile
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { sendKontakt } from "./contact-api";

// Client-side validation schema (uten turnstileToken - legges til ved submit)
const KontaktFormSchema = z.object({
  navn: z
    .string()
    .trim()
    .min(2, "Navn må være minst 2 tegn")
    .max(100, "Navn kan ikke være mer enn 100 tegn"),
  epost: z
    .string()
    .trim()
    .email("Ugyldig e-postadresse")
    .max(320, "E-post kan ikke være mer enn 320 tegn"),
  emne: z
    .string()
    .trim()
    .min(3, "Emne må være minst 3 tegn")
    .max(140, "Emne kan ikke være mer enn 140 tegn"),
  melding: z
    .string()
    .trim()
    .min(10, "Meldingen må være minst 10 tegn")
    .max(5000, "Meldingen kan ikke være mer enn 5000 tegn"),
});

type KontaktFormData = z.infer<typeof KontaktFormSchema>;

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function ContactForm() {
  const [isSending, setIsSending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KontaktFormData>({
    resolver: zodResolver(KontaktFormSchema),
  });

  // Callback for Turnstile success
  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  // Callback for Turnstile error/expired
  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  // Load Turnstile script and render widget
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || typeof window === "undefined") return;

    if (!TURNSTILE_SITE_KEY || typeof window === "undefined") return;

    const renderWidget = () => {
      if (
        turnstileRef.current &&
        !widgetIdRef.current &&
        (window as unknown as { turnstile?: { render: (el: HTMLElement, opts: object) => string } }).turnstile
      ) {
        const turnstile = (window as unknown as { turnstile: { render: (el: HTMLElement, opts: object) => string } }).turnstile;
        widgetIdRef.current = turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => onTurnstileSuccess(token),
          "error-callback": () => onTurnstileError(),
          "expired-callback": () => onTurnstileError(),
          theme: "auto",
        });
        setTurnstileLoaded(true);
      }
    };

    // Check if script already loaded
    if ((window as unknown as { turnstile?: object }).turnstile) {
      renderWidget();
      return;
    }

    // Load Turnstile script
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // Small delay to ensure Turnstile is fully initialized
      setTimeout(renderWidget, 100);
    };
    document.head.appendChild(script);
  }, [onTurnstileSuccess, onTurnstileError]);

  // Reset Turnstile after submission
  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    if (
      widgetIdRef.current &&
      (window as unknown as { turnstile?: { reset: (id: string) => void } }).turnstile
    ) {
      (window as unknown as { turnstile: { reset: (id: string) => void } }).turnstile.reset(widgetIdRef.current);
    }
  }, []);

  // Sjekk om Turnstile er konfigurert
  const isTurnstileRequired = !!TURNSTILE_SITE_KEY;

  const onSubmit = async (data: KontaktFormData) => {
    // Krev Turnstile-token kun hvis Turnstile er konfigurert
    if (isTurnstileRequired && !turnstileToken) {
      toast.error("Vennligst fullfør verifiseringen");
      return;
    }

    setIsSending(true);

    try {
      const result = await sendKontakt({
        ...data,
        // Bruk "dev-bypass" token i dev når Turnstile ikke er konfigurert
        turnstileToken: turnstileToken ?? "dev-bypass",
        // Honeypot: les faktisk verdi fra skjult felt (bots fyller ofte ut alle felt)
        nettsted: honeypotRef.current?.value ?? "",
      });

      if (result.success) {
        toast.success(result.melding ?? "Takk for din henvendelse!");
        reset();
        resetTurnstile();
      } else {
        toast.error(result.error ?? "Noe gikk galt. Prøv igjen senere.");
        resetTurnstile();
      }
    } catch {
      toast.error("Kunne ikke sende meldingen. Prøv igjen senere.");
      resetTurnstile();
    } finally {
      setIsSending(false);
    }
  };

  const inputClassName =
    "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400";

  const errorClassName = "mt-1 text-sm text-red-500 dark:text-red-400";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Honeypot - skjult felt som bots fyller ut */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="nettsted">Nettsted</label>
        <input
          ref={honeypotRef}
          type="text"
          id="nettsted"
          name="nettsted"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <label
          htmlFor="navn"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Navn
        </label>
        <input
          type="text"
          id="navn"
          placeholder="Ditt navn"
          className={inputClassName}
          disabled={isSending}
          {...register("navn")}
        />
        {errors.navn && <p className={errorClassName}>{errors.navn.message}</p>}
      </div>

      <div>
        <label
          htmlFor="epost"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          E-post
        </label>
        <input
          type="email"
          id="epost"
          placeholder="din@epost.no"
          className={inputClassName}
          disabled={isSending}
          {...register("epost")}
        />
        {errors.epost && <p className={errorClassName}>{errors.epost.message}</p>}
      </div>

      <div>
        <label
          htmlFor="emne"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Emne
        </label>
        <input
          type="text"
          id="emne"
          placeholder="Hva gjelder henvendelsen?"
          className={inputClassName}
          disabled={isSending}
          {...register("emne")}
        />
        {errors.emne && <p className={errorClassName}>{errors.emne.message}</p>}
      </div>

      <div>
        <label
          htmlFor="melding"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Melding
        </label>
        <textarea
          id="melding"
          placeholder="Skriv din melding her..."
          rows={5}
          className={`${inputClassName} resize-none`}
          disabled={isSending}
          {...register("melding")}
        />
        {errors.melding && <p className={errorClassName}>{errors.melding.message}</p>}
      </div>

      {/* Turnstile widget */}
      {TURNSTILE_SITE_KEY && (
        <div className="flex justify-center">
          <div ref={turnstileRef} />
          {!turnstileLoaded && (
            <div className="flex h-[65px] w-[300px] items-center justify-center rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={isSending || (isTurnstileRequired && !turnstileToken)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {isSending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sender...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Send melding
          </>
        )}
      </button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Din henvendelse brukes kun til å besvare deg.{" "}
        <span className="block sm:inline">
          Unngå å sende sensitive personopplysninger.
        </span>
      </p>
    </form>
  );
}

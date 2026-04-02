"use client";

/**
 * Kontaktskjema-komponent
 * Bruker react-hook-form, Zod-validering og Cloudflare Turnstile
 */

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Send, Loader2, ImagePlus, X } from "lucide-react";
import {
  KONTAKT_ALLOWED_ATTACHMENT_TYPES,
  KONTAKT_MAX_ATTACHMENTS,
  KONTAKT_MAX_ATTACHMENT_SIZE_BYTES,
} from "common/contact";
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
  const [attachments, setAttachments] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KontaktFormData>({
    resolver: zodResolver(KontaktFormSchema),
  });

  // Callback ved Turnstile-suksess
  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  // Callback ved Turnstile-feil/utløpt
  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  // Last inn Turnstile-script og render widget
  useEffect(() => {
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

    // Sjekk om script allerede er lastet
    if ((window as unknown as { turnstile?: object }).turnstile) {
      renderWidget();
      return;
    }

    // Last inn Turnstile-script
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // Liten forsinkelse for å sikre at Turnstile er ferdig initialisert
      setTimeout(renderWidget, 100);
    };
    document.head.appendChild(script);
  }, [onTurnstileSuccess, onTurnstileError]);

  // Tilbakestill Turnstile etter innsending
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
        turnstileToken: turnstileToken ?? "",
        // Honeypot: les faktisk verdi fra skjult felt (bots fyller ofte ut alle felt)
        nettsted: honeypotRef.current?.value ?? "",
        sideUrl: typeof window !== "undefined" ? window.location.href : undefined,
        attachments,
      });

      if (result.success) {
        toast.success(result.melding ?? "Takk for din henvendelse!");
        reset();
        setAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
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
  const acceptedTypes = KONTAKT_ALLOWED_ATTACHMENT_TYPES.join(",");
  const maxAttachmentSizeMb = Math.floor(KONTAKT_MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024));

  const formatFileSize = (size: number) => {
    if (size < 1024 * 1024) {
      return `${Math.ceil(size / 1024)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleAttachmentsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length === 0) {
      setAttachments([]);
      return;
    }

    const nextFiles: File[] = [];
    for (const file of selectedFiles) {
      if (!KONTAKT_ALLOWED_ATTACHMENT_TYPES.includes(
        file.type as (typeof KONTAKT_ALLOWED_ATTACHMENT_TYPES)[number],
      )) {
        toast.error("Kun JPG, PNG og WebP-bilder er tillatt");
        continue;
      }
      if (file.size > KONTAKT_MAX_ATTACHMENT_SIZE_BYTES) {
        toast.error(`Hvert bilde må være mindre enn ${maxAttachmentSizeMb} MB`);
        continue;
      }
      nextFiles.push(file);
    }

    if (nextFiles.length > KONTAKT_MAX_ATTACHMENTS) {
      toast.error(`Du kan laste opp maks ${KONTAKT_MAX_ATTACHMENTS} bilder`);
      setAttachments(nextFiles.slice(0, KONTAKT_MAX_ATTACHMENTS));
      return;
    }

    setAttachments(nextFiles);
  };

  const removeAttachment = (indexToRemove: number) => {
    setAttachments((current) => {
      const next = current.filter((_, index) => index !== indexToRemove);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
  };

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

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Bilder ved behov
        </p>
        <label
          htmlFor="attachments"
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:bg-slate-800"
        >
          <ImagePlus className="h-4 w-4" />
          Velg opptil {KONTAKT_MAX_ATTACHMENTS} bilder
        </label>
        <input
          ref={fileInputRef}
          id="attachments"
          type="file"
          accept={acceptedTypes}
          multiple
          className="hidden"
          disabled={isSending}
          onChange={handleAttachmentsChange}
        />
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          JPG, PNG eller WebP. Maks {KONTAKT_MAX_ATTACHMENTS} bilder, {maxAttachmentSizeMb} MB per bilde.
        </p>
        {attachments.length > 0 && (
          <ul className="mt-3 space-y-2">
            {attachments.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="ml-3 rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  aria-label={`Fjern ${file.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
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

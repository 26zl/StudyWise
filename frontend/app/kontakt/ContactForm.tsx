"use client";

/**
 * Kontaktskjema-komponent
 * Bruker react-hook-form, Zod-validering og Cloudflare Turnstile
 */

import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from "react";
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
import { useLanguage } from "@/app/i18n";
import { sendKontakt } from "./contact-api";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** Cloudflare Turnstile widget-API (lastes via eksternt script) */
interface TurnstileWidget {
  render: (el: HTMLElement, opts: object) => string;
  reset: (id: string) => void;
}

/** Henter Turnstile-widget fra window (undefined hvis scriptet ikke er lastet) */
function getTurnstile(): TurnstileWidget | undefined {
  return (window as unknown as { turnstile?: TurnstileWidget }).turnstile;
}

type KontaktFormData = {
  navn: string;
  epost: string;
  emne: string;
  melding: string;
};

export function ContactForm() {
  const { t } = useLanguage();
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Zod-schema med oversatte feilmeldinger
  const KontaktFormSchema = useMemo(() => z.object({
    navn: z
      .string()
      .trim()
      .min(2, t("contactForm.nameMinError"))
      .max(100, t("contactForm.nameMaxError")),
    epost: z
      .string()
      .trim()
      .email(t("contactForm.emailError"))
      .max(320, t("contactForm.emailMaxError")),
    emne: z
      .string()
      .trim()
      .min(3, t("contactForm.subjectMinError"))
      .max(140, t("contactForm.subjectMaxError")),
    melding: z
      .string()
      .trim()
      .min(10, t("contactForm.messageMinError"))
      .max(5000, t("contactForm.messageMaxError")),
  }), [t]);

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
      const turnstile = getTurnstile();
      if (
        turnstileRef.current &&
        !widgetIdRef.current &&
        turnstile
      ) {
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
    if (getTurnstile()) {
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
    const turnstile = getTurnstile();
    if (widgetIdRef.current && turnstile) {
      turnstile.reset(widgetIdRef.current);
    }
  }, []);

  // Sjekk om Turnstile er konfigurert
  const isTurnstileRequired = !!TURNSTILE_SITE_KEY;

  const onSubmit = async (data: KontaktFormData) => {
    // Krev Turnstile-token kun hvis Turnstile er konfigurert
    if (isTurnstileRequired && !turnstileToken) {
      toast.error(t("contactForm.turnstileError"));
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
        toast.success(result.melding ?? t("contactForm.successDefault"));
        reset();
        setAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        resetTurnstile();
      } else {
        toast.error(result.error ?? t("contactForm.errorDefault"));
        resetTurnstile();
      }
    } catch {
      toast.error(t("contactForm.networkError"));
      resetTurnstile();
    } finally {
      setIsSending(false);
    }
  };

  const inputClassName =
    "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400";

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
        toast.error(t("contactForm.imageTypeError"));
        continue;
      }
      if (file.size > KONTAKT_MAX_ATTACHMENT_SIZE_BYTES) {
        toast.error(t("contactForm.imageSizeError").replace("{size}", String(maxAttachmentSizeMb)));
        continue;
      }
      nextFiles.push(file);
    }

    if (nextFiles.length > KONTAKT_MAX_ATTACHMENTS) {
      toast.error(t("contactForm.imageCountError").replace("{count}", String(KONTAKT_MAX_ATTACHMENTS)));
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
          {t("contactForm.nameLabel")}
        </label>
        <input
          type="text"
          id="navn"
          placeholder={t("contactForm.namePlaceholder")}
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
          {t("contactForm.emailLabel")}
        </label>
        <input
          type="email"
          id="epost"
          placeholder={t("contactForm.emailPlaceholder")}
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
          {t("contactForm.subjectLabel")}
        </label>
        <input
          type="text"
          id="emne"
          placeholder={t("contactForm.subjectPlaceholder")}
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
          {t("contactForm.messageLabel")}
        </label>
        <textarea
          id="melding"
          placeholder={t("contactForm.messagePlaceholder")}
          rows={5}
          className={`${inputClassName} resize-none`}
          disabled={isSending}
          {...register("melding")}
        />
        {errors.melding && <p className={errorClassName}>{errors.melding.message}</p>}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("contactForm.imagesLabel")}
        </p>
        <label
          htmlFor="attachments"
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:bg-slate-800"
        >
          <ImagePlus className="h-4 w-4" />
          {t("contactForm.imagesSelect").replace("{count}", String(KONTAKT_MAX_ATTACHMENTS))}
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
          {t("contactForm.imagesHint").replace("{count}", String(KONTAKT_MAX_ATTACHMENTS)).replace("{size}", String(maxAttachmentSizeMb))}
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
                  aria-label={t("contactForm.removeImage").replace("{name}", file.name)}
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
            <div className="flex h-16.25 w-75 items-center justify-center rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
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
            {t("contactForm.sending")}
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            {t("contactForm.send")}
          </>
        )}
      </button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        {t("contactForm.disclaimer")}{" "}
        <span className="block sm:inline">
          {t("contactForm.disclaimerSensitive")}
        </span>
      </p>
    </form>
  );
}

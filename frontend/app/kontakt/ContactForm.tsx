"use client";

/**
 * Kontaktskjema-komponent
 * Bruker react-hook-form, Zod-validering og Cloudflare Turnstile
 */

import { useEffect, useState, useRef, useCallback, useMemo, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/app/components/ui/Toaster";
import { Send, Loader2, ImagePlus, X, AlertCircle } from "lucide-react";
import {
  KONTAKT_ALLOWED_ATTACHMENT_TYPES,
  KONTAKT_MAX_ATTACHMENTS,
  KONTAKT_MAX_ATTACHMENT_SIZE_BYTES,
  isValidReportedErrorId,
} from "common/contact";
import { useLanguage } from "@/app/i18n";
import { useTurnstileScript } from "@/app/hooks/useTurnstileScript";
import {
  clearLastApiErrorRequestId,
  getLastApiErrorRequestId,
  rememberReportableErrorId,
} from "@/app/lib/apiClient";
import { sendKontakt } from "./contact-api";

function sanitizeReportedErrorId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!isValidReportedErrorId(trimmed)) return undefined;
  return trimmed;
}

import { turnstileEnabled } from "@/app/lib/validateEnv";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Effektivt aktiveringsflagg: krever både master-flagg OG sitekey
const TURNSTILE_ACTIVE = turnstileEnabled && !!TURNSTILE_SITE_KEY;

type KontaktFormData = {
  navn: string;
  epost: string;
  emne: string;
  melding: string;
};

function hentSanertSidekontekst(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const sanitizedPath = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^[A-Za-z0-9_-]{12,}$/.test(segment) || /^[0-9a-f]{24}$/i.test(segment) ? "[id]" : segment,
    )
    .join("/");

  return sanitizedPath ? `/${sanitizedPath}` : "/";
}

export function ContactForm() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Feil-ID kommer normalt fra sessionStorage, men kan også leveres transient via
  // `?errorId=` når brukeren sendes til kontaktsiden. Query-parametret lagres
  // umiddelbart i sessionStorage og fjernes deretter fra URL-en for å unngå at
  // analytics/pageview-loggere plukker det opp fra adresselinjen.
  const [reportedErrorId, setReportedErrorId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const rawFromUrl = searchParams.get("errorId");

    if (rawFromUrl !== null) {
      const fromUrl = sanitizeReportedErrorId(rawFromUrl);
      if (fromUrl) {
        rememberReportableErrorId(fromUrl);
      }
      setReportedErrorId(fromUrl);

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("errorId");
        const nextSearch = url.searchParams.toString();
        const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
        window.history.replaceState(window.history.state, "", nextUrl);
      }
      return;
    }

    const fromSession = sanitizeReportedErrorId(getLastApiErrorRequestId());
    setReportedErrorId(fromSession);
  }, [searchParams]);

  const onTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  const onTurnstileError = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  const {
    containerRef: turnstileRef,
    isLoaded: turnstileLoaded,
    reset: resetTurnstileWidget,
  } = useTurnstileScript({
    siteKey: TURNSTILE_SITE_KEY,
    onSuccess: onTurnstileSuccess,
    onError: onTurnstileError,
    onExpired: onTurnstileError,
    enabled: TURNSTILE_ACTIVE,
  });

  // Zod-schema med oversatte feilmeldinger
  const KontaktFormSchema = useMemo(
    () =>
      z.object({
        navn: z
          .string()
          .trim()
          .min(2, t("contactForm.nameMinError"))
          .max(100, t("contactForm.nameMaxError")),
        epost: z.email(t("contactForm.emailError")).trim().max(320, t("contactForm.emailMaxError")),
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
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KontaktFormData>({
    // @hookform/resolvers@5.2.2 sin type-stamp ligger bak Zod 4.3.x sin
    // interne `_zod.version.minor`-bump (minor=3 vs forventet 0). Runtime
    // fungerer perfekt — kun et TS-overload-mismatch. Cast bypasser sjekken
    // til en oppstrøms-fix lander. Kan fjernes når @hookform/resolvers > 5.2.2.
    resolver: zodResolver(KontaktFormSchema as never),
  });

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    resetTurnstileWidget();
  }, [resetTurnstileWidget]);

  const isTurnstileRequired = TURNSTILE_ACTIVE;

  const onSubmit = async (data: KontaktFormData) => {
    // Krev Turnstile-token kun hvis Turnstile er aktivt (master-flagg + sitekey)
    if (isTurnstileRequired && !turnstileToken) {
      showToast.error(t("contactForm.turnstileError"));
      return;
    }

    setIsSending(true);

    try {
      const result = await sendKontakt({
        ...data,
        turnstileToken: turnstileToken ?? "",
        // Honeypot: les faktisk verdi fra skjult felt (bots fyller ofte ut alle felt)
        nettsted: honeypotRef.current?.value ?? "",
        sideUrl: hentSanertSidekontekst(),
        reportedErrorId,
        attachments,
      });

      if (result.success) {
        showToast.success(result.melding ?? t("contactForm.successDefault"));
        reset();
        setAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        resetTurnstile();
        // Etter vellykket innsending: fjern ID-en slik at neste kontakt-besøk
        // ikke rapporterer samme feil på nytt.
        setReportedErrorId(undefined);
        clearLastApiErrorRequestId();
      } else {
        showToast.error(result.error ?? t("contactForm.errorDefault"));
        resetTurnstile();
      }
    } catch {
      showToast.error(t("contactForm.networkError"));
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
      if (
        !KONTAKT_ALLOWED_ATTACHMENT_TYPES.includes(
          file.type as (typeof KONTAKT_ALLOWED_ATTACHMENT_TYPES)[number],
        )
      ) {
        showToast.error(t("contactForm.imageTypeError"));
        continue;
      }
      if (file.size > KONTAKT_MAX_ATTACHMENT_SIZE_BYTES) {
        showToast.error(t("contactForm.imageSizeError").replace("{size}", String(maxAttachmentSizeMb)));
        continue;
      }
      nextFiles.push(file);
    }

    if (nextFiles.length > KONTAKT_MAX_ATTACHMENTS) {
      showToast.error(
        t("contactForm.imageCountError").replace("{count}", String(KONTAKT_MAX_ATTACHMENTS)),
      );
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

      {/* Feil-ID-banner: vises når brukeren har kommet hit via en lenke fra error boundary,
          eller sist /api-kall feilet. Banner bekrefter for brukeren at feilen blir rapportert. */}
      {reportedErrorId && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
          role="status"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{t("contactForm.errorIdAttachedTitle")}</p>
            <p className="mt-0.5 font-mono text-[11px] break-all text-amber-800/90 dark:text-amber-200/90">
              {reportedErrorId}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReportedErrorId(undefined);
              clearLastApiErrorRequestId();
            }}
            className="ml-auto rounded p-1 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
            aria-label={t("contactForm.errorIdRemove")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
          {t("contactForm.imagesHint")
            .replace("{count}", String(KONTAKT_MAX_ATTACHMENTS))
            .replace("{size}", String(maxAttachmentSizeMb))}
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

      {/* Turnstile widget — kun synlig når master-flagg er på */}
      {TURNSTILE_ACTIVE && (
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
        <span className="block sm:inline">{t("contactForm.disclaimerSensitive")}</span>
      </p>
    </form>
  );
}

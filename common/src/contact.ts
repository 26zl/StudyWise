/**
 * Kontaktskjema-typer og Zod-schemaer
 * Deles mellom frontend og backend
 */

import { z } from "zod";

export const KONTAKT_ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png"] as const;

export const KONTAKT_MAX_ATTACHMENTS = 3;
export const KONTAKT_MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Maks total body-størrelse for POST /api/kontakt (summen av alle attachments
 * + tekst-felter + multipart-overhead). Backend bruker denne for å avvise store
 * payloads tidlig, før multer leser bodyen inn i minne. Frontend kan bruke den
 * til å pre-validere før send.
 */
export const KONTAKT_MAX_TOTAL_BODY_BYTES =
  KONTAKT_MAX_ATTACHMENTS * KONTAKT_MAX_ATTACHMENT_SIZE_BYTES + 50_000;

export const REPORTED_ERROR_ID_MAX_LENGTH = 128;

const KONTAKT_SIDE_PATH_REGEX = /^\/(?!\/)[^\s?#]*$/;
export const REPORTED_ERROR_ID_PATTERN = /^[\w.:-]+$/;

export function isValidReportedErrorId(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= REPORTED_ERROR_ID_MAX_LENGTH &&
    REPORTED_ERROR_ID_PATTERN.test(trimmed)
  );
}

/**
 * Delt schema for request-/error-ID-er som kan vises til bruker og brukes til
 * korrelering i logger/admin.
 *
 * Mønsteret `[\w.:-]` matcher formatet backend request-id-middleware genererer:
 * alfanumerisk + understrek + punktum + kolon + bindestrek (typisk
 * `req-<nanoid>` eller `req.<id>`). Hvis ID-formatet noen gang utvides
 * (f.eks. base64 med `=`/`+`/`/`, eller UUID med `+`), MÅ regex og maks-lengde
 * her oppdateres samtidig — ellers vil gyldige request-IDer bli avvist eller
 * silent-droppet av klientfiltrering.
 */
export const ReportedErrorIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(REPORTED_ERROR_ID_MAX_LENGTH)
  .regex(REPORTED_ERROR_ID_PATTERN, "Ugyldig feil-ID");

export const KontaktAttachmentSchema = z.object({
  filnavn: z.string().trim().min(1).max(255),
  mimeType: z.enum(KONTAKT_ALLOWED_ATTACHMENT_TYPES),
  størrelse: z.number().int().positive().max(KONTAKT_MAX_ATTACHMENT_SIZE_BYTES),
  innholdBase64: z
    .string()
    .trim()
    .min(1)
    .max(Math.ceil((KONTAKT_MAX_ATTACHMENT_SIZE_BYTES * 4) / 3) + 4),
});

/**
 * Kontaktforespørsel-schema for POST /api/kontakt.
 *
 * Endepunktet aksepterer `multipart/form-data` med tekstfelter definert her
 * PLUSS valgfri `attachments[]` (JPG/PNG, maks `KONTAKT_MAX_ATTACHMENTS` stk à
 * `KONTAKT_MAX_ATTACHMENT_SIZE_BYTES`). Filene valideres av backend via multer
 * og magic bytes — dette schema dekker bare tekstfeltene. Bruk
 * `KONTAKT_ALLOWED_ATTACHMENT_TYPES` og `KONTAKT_MAX_TOTAL_BODY_BYTES` for
 * konsistent fil-validering mellom frontend og backend.
 */
export const KontaktRequestSchema = z.object({
  navn: z
    .string()
    .trim()
    .min(2, "Navn må være minst 2 tegn")
    .max(100, "Navn kan ikke være mer enn 100 tegn"),
  epost: z
    .string()
    .trim()
    .max(320, "E-post kan ikke være mer enn 320 tegn")
    .pipe(z.email("Ugyldig e-postadresse")),
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
  turnstileToken: z.string().trim().max(2048, "Verifiseringstoken er ugyldig").default(""),
  // Honeypot-felt: skal alltid være tomt (sendes som skjult felt)
  nettsted: z.string().trim().max(200).optional(),
  // Valgfri metadata: sanert intern sti der brukeren sendte skjemaet fra
  sideUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (v) => KONTAKT_SIDE_PATH_REGEX.test(v),
      "Sidekontekst må være en sanert intern sti uten query eller hash",
    )
    .optional(),
  // Valgfri: X-Request-ID fra den feilede request-en som brukeren rapporterer om.
  // Lar admin korrelere innsendingen med Pino-logger, Datadog APM og AuditLog.
  reportedErrorId: ReportedErrorIdSchema.optional(),
});

export type KontaktRequest = z.infer<typeof KontaktRequestSchema>;
export type KontaktAttachment = z.infer<typeof KontaktAttachmentSchema>;

/**
 * Kontaktrespons-schema
 */
export const KontaktResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string(),
});

export type KontaktResponse = z.infer<typeof KontaktResponseSchema>;

/**
 * Kontaktskjema-typer og Zod-schemaer
 * Deles mellom frontend og backend
 */

import { z } from "zod";

/**
 * Kontaktforespørsel-schema for POST /api/kontakt
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
  turnstileToken: z
    .string()
    .trim()
    .min(1, "Verifisering kreves")
    .max(2048, "Verifiseringstoken er ugyldig"),
  // Honeypot-felt: skal alltid være tomt (sendes som skjult felt)
  nettsted: z.string().trim().max(200).optional(),
  // Valgfri metadata: URL der brukeren sendte skjemaet fra
  sideUrl: z
    .string()
    .url()
    .max(2000)
    .optional(),
});

export type KontaktRequest = z.infer<typeof KontaktRequestSchema>;

/**
 * Kontaktrespons-schema
 */
export const KontaktResponseSchema = z.object({
  suksess: z.boolean(),
  melding: z.string(),
});

export type KontaktResponse = z.infer<typeof KontaktResponseSchema>;

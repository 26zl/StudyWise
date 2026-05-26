/**
 * Kontaktskjema API-klient
 * Bruker fetchApi for å sende kontaktskjema-forespørsler
 */

import { fetchApi } from "@/app/lib/apiClient";
import { KontaktResponseSchema, type KontaktRequest } from "common/contact";

export interface SendKontaktResult {
  success: boolean;
  melding?: string;
  error?: string;
}

interface ApiErrorResponse {
  melding?: string;
  feil?: string;
  message?: string;
  error?: string;
}

export interface SendKontaktPayload extends KontaktRequest {
  attachments?: File[];
}

/**
 * Sender kontaktskjema til backend.
 * Kaster ved nettverksfeil — kaller-koden håndterer dette i sin catch-gren.
 * Returnerer { success: false } ved HTTP-feil fra serveren.
 */
export async function sendKontakt(data: SendKontaktPayload): Promise<SendKontaktResult> {
  const formData = new FormData();
  formData.append("navn", data.navn);
  formData.append("epost", data.epost);
  formData.append("emne", data.emne);
  formData.append("melding", data.melding);
  formData.append("turnstileToken", data.turnstileToken);
  formData.append("nettsted", data.nettsted ?? "");
  if (data.sideUrl) {
    formData.append("sideUrl", data.sideUrl);
  }
  if (data.reportedErrorId) {
    formData.append("reportedErrorId", data.reportedErrorId);
  }
  for (const attachment of data.attachments ?? []) {
    formData.append("attachments", attachment);
  }

  const response = await fetchApi(
    "/api/kontakt",
    {
      method: "POST",
      body: formData,
    },
    { auth: false },
  );

  if (!response.ok) {
    const errorData: ApiErrorResponse = await response.json().catch(() => ({}));
    return {
      success: false,
      error:
        errorData.melding ||
        errorData.feil ||
        errorData.message ||
        errorData.error ||
        "Noe gikk galt. Prøv igjen senere.",
    };
  }

  const result = KontaktResponseSchema.parse(await response.json());
  return {
    success: result.suksess,
    melding: result.melding,
  };
}

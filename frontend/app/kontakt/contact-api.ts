/**
 * Kontaktskjema API-klient
 * Bruker fetchApi for å sende kontaktskjema-forespørsler
 */

import { fetchApi } from "@/app/lib/apiClient";
import type { KontaktRequest, KontaktResponse } from "common/contact";

export interface SendKontaktResult {
  success: boolean;
  melding?: string;
  error?: string;
}

interface ApiErrorResponse {
  message?: string;
  error?: string;
}

/**
 * Sender kontaktskjema til backend
 * Bruker auth: false siden kontakt-endepunktet er offentlig
 * Bruker relativ URL for å gå gjennom Next.js proxy
 */
export async function sendKontakt(
  data: KontaktRequest,
): Promise<SendKontaktResult> {
  try {
    const response = await fetchApi(
      "/api/kontakt",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
      { auth: false },
    );

    if (!response.ok) {
      const errorData: ApiErrorResponse = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.message || errorData.error || "Noe gikk galt. Prøv igjen senere.",
      };
    }

    const result = (await response.json()) as KontaktResponse;
    return {
      success: result.suksess,
      melding: result.melding,
    };
  } catch {
    // Nettverksfeil eller andre uventede feil
    return {
      success: false,
      error: "Kunne ikke sende meldingen. Sjekk internettforbindelsen din.",
    };
  }
}

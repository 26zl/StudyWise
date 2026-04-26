/**
 * Mapper Cloudflare Turnstile-feilkoder til i18n-nøkler for årsak og løsning.
 *
 * Kodegrupper (basert på Cloudflare-dokumentasjon):
 *   100xxx — initialisering / konfig
 *   110xxx — sitekey / domene
 *   200xxx — nettverk / API
 *   300xxx — challenge-utførelse
 *   400xxx — klient-validering
 *   600xxx — generisk klient-eksekvering (vanligvis browser/extension/VPN)
 *
 * Vi lister kun kodene vi har sett i prod / som har konkrete brukerråd.
 * For ukjente koder returnerer vi `null` og UI viser bare koden uten råd.
 */
export interface TurnstileErrorHelp {
  causeKey: string;
  solutionKey: string;
}

export function getTurnstileErrorHelp(code: string | null): TurnstileErrorHelp | null {
  if (!code) return null;

  // Eksakte koder vi har sett / som har spesifikt råd
  switch (code) {
    case "300010":
    case "600010":
      // Generisk widget-eksekveringsfeil. Vanligst: VPN, restriktiv extension, eller
      // strenge nettleserinnstillinger som blokkerer Cloudflare-scripts.
      return {
        causeKey: "auth.humanCheck.errorHelp.600010.cause",
        solutionKey: "auth.humanCheck.errorHelp.600010.solution",
      };
    case "110200":
      // Domain not allowed for sitekey — feilkonfigurasjon på vår side.
      return {
        causeKey: "auth.humanCheck.errorHelp.110200.cause",
        solutionKey: "auth.humanCheck.errorHelp.110200.solution",
      };
  }

  // Familier basert på prefiks
  if (code.startsWith("200")) {
    // Nettverk/API — Cloudflares server svarer ikke eller klienten er offline
    return {
      causeKey: "auth.humanCheck.errorHelp.network.cause",
      solutionKey: "auth.humanCheck.errorHelp.network.solution",
    };
  }

  if (code.startsWith("300") || code.startsWith("600")) {
    // Challenge feilet på klient-siden
    return {
      causeKey: "auth.humanCheck.errorHelp.client.cause",
      solutionKey: "auth.humanCheck.errorHelp.client.solution",
    };
  }

  if (code.startsWith("400")) {
    // Klient-validering feilet — token utløpt, duplikat, eller mistenkelig
    return {
      causeKey: "auth.humanCheck.errorHelp.expired.cause",
      solutionKey: "auth.humanCheck.errorHelp.expired.solution",
    };
  }

  return null;
}

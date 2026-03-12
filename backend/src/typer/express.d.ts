/*
* Utvider Express Request-objektet med bruker- og canvasToken-egenskaper
*/
import { JwtPayload } from "jsonwebtoken";

// JWT payload for autentiserte brukere (kun id + tokenType; email hentes fra DB ved behov)
export interface JwtBrukerPayload extends JwtPayload {
  id: string;
  tokenType?: "access" | "refresh";
}
// Utvid Express Request for å inkludere brukerinfo og Canvas token
declare global {
  namespace Express {
    interface Request {
      user?: JwtBrukerPayload;
      canvasToken?: string;
      /** Canvas base URL for brukerens institusjon (multi-tenant). Sett av auth-middleware. */
      canvasBaseUrl?: string;
    }
  }
}

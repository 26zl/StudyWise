/*
* Utvider Express Request-objektet med bruker- og canvasToken-egenskaper
*/
import { JwtPayload } from "jsonwebtoken";

// JWT payload for autentiserte brukere
export interface JwtBrukerPayload extends JwtPayload {
  id: string;
  email: string;
  tokenType?: "access" | "refresh";
}
// Utvid Express Request for å inkludere brukerinfo og Canvas token
declare global {
  namespace Express {
    interface Request {
      user?: JwtBrukerPayload;
      canvasToken?: string;
    }
  }
}

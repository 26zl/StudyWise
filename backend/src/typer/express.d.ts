/*
 * Utvider Express Request med bruker, rolle, request-id og Canvas-token.
 * Clerk-only: req.user.id er MongoDB User._id; req.actorRole er fra User.role.
 */
import type { UserRole } from "common/auth";

export interface AuthUser {
  id: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Request ID for korrelasjon (satt av request-id middleware). */
      id?: string;
      /** Autentisert bruker (MongoDB User._id). */
      user?: AuthUser;
      /** Rolle for autentisert bruker (satt av requireAuth). */
      actorRole?: UserRole;
      canvasToken?: string;
      /** Canvas base URL for brukerens institusjon (multi-tenant). */
      canvasBaseUrl?: string;
    }
  }
}

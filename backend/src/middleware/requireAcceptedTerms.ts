/**
 * requireAcceptedTerms — håndhever at brukeren har godtatt gjeldende versjon av
 * vilkår og personvernerklæring (TERMS_VERSION) før hun får bruke beskyttede
 * endepunkter.
 *
 * Dette er en backend-bekreftelse på det frontend-modalen viser. Hvis en bruker
 * fjerner modalen via DevTools eller kaller API-et direkte, blir hun fortsatt
 * blokkert her — og forsøket audit-logges som juridisk bevis på at vi har
 * konsekvent håndhevet aksept.
 *
 * Allowlisten (under) holder de få endepunktene åpne som brukeren TRENGER for
 * å enten godta nye vilkår, logge ut eller utøve sin GDPR Art. 17-rett til
 * sletting. Alt annet returnerer 403 `terms_outdated`.
 *
 * Kjøres etter `requireAuth`, som setter `req.authenticatedUser`.
 */
import type { NextFunction, Request, Response } from "express";
import { TERMS_VERSION } from "common/system";
import type { IUser } from "../database/models/User.js";
import { logger } from "../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";

/**
 * Endepunkter som SKAL fungere selv når brukeren har utdaterte vilkår.
 * Matches bruker eksakt path ELLER eksakt path + "/" (for å unngå at en
 * fremtidig rute som `/api/user/accountsexport` automatisk omgår håndhevelsen
 * bare fordi prefiksen tilfeldigvis starter likt).
 */
const ALLOWED: Array<{ method: string; path: string }> = [
  // Frontend trenger /me for å vite at modalen skal vises
  { method: "GET", path: "/api/user/me" },
  // Selve aksept-endepunktet
  { method: "POST", path: "/api/user/accept-terms" },
  // Brukeren kan alltid logge ut
  { method: "POST", path: "/api/user/logout" },
  // GDPR Art. 17: brukeren kan alltid slette kontoen sin uten å godta nye vilkår
  { method: "DELETE", path: "/api/user/account" },
  // Systembanner (driftsmeldinger) skal vises også for bruker som ikke har akseptert
  { method: "GET", path: "/api/announcement" },
  // GDPR Art. 7(3): samtykke (cookieConsent) lagres under uiPreferences.
  // Tilbaketrekking av samtykke må være minst like enkelt som å gi det, og kan
  // ikke betinges av at brukeren først godtar nye vilkår. Allowlister derfor
  // hele preferanse-endepunktet.
  { method: "PUT", path: "/api/user/preferences" },
];

function isAllowed(req: Request): boolean {
  return ALLOWED.some((entry) => {
    if (req.method !== entry.method) return false;
    if (req.path === entry.path) return true;
    // Tillat barn-ruter under allowlisted path (f.eks. `/api/user/me/subresource`),
    // men IKKE søsken som bare deler prefiks (`/api/user/me-other`).
    return req.path.startsWith(entry.path + "/");
  });
}

export async function requireAcceptedTerms(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // CORS preflights skal aldri blokkeres her
  if (req.method === "OPTIONS") {
    return next();
  }

  const user = (req as Request & { authenticatedUser?: IUser })
    .authenticatedUser;

  // Hvis ingen autentisert bruker er satt, har auth-laget allerede tatt
  // beslutningen — vi blander oss ikke inn (publike endepunkter, eller en
  // 401 som kommer rett etter denne middlewaren).
  if (!user) {
    return next();
  }

  if (user.termsVersionAccepted === TERMS_VERSION) {
    return next();
  }

  if (isAllowed(req)) {
    return next();
  }

  // Audit-spor: bevis på at vi blokkerte fortsatt-bruk uten ny aksept.
  // Failure-outcome valgt for konsistens med andre access-denied-hendelser.
  audit({
    actorUserId: user._id.toString(),
    action: AUDIT_ACTIONS.TERMS_ENFORCEMENT_BLOCKED,
    category: "privacy",
    outcome: "failure",
    role: user.role ?? "user",
    metadata: {
      acceptedVersion: user.termsVersionAccepted ?? null,
      currentVersion: TERMS_VERSION,
      method: req.method,
      path: req.path,
    },
    req,
  }).catch((err) => {
    logger.warn({ err }, "Kunne ikke skrive terms_enforcement_blocked audit");
  });

  res.status(403).json({
    error: "terms_outdated",
    kode: "terms_outdated",
    melding:
      "Du må godta de oppdaterte brukervilkårene og personvernerklæringen før du kan fortsette. Last siden på nytt for å se modalen.",
    requiredVersion: TERMS_VERSION,
    acceptedVersion: user.termsVersionAccepted ?? null,
  });
}

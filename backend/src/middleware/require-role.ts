/**
 * RBAC: krever én av de tillatte rollene. Må kjøres etter requireAuth (req.actorRole satt).
 */
import type { Request, Response, NextFunction } from "express";
import { apiError } from "../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { checkSecurityThresholds } from "../utils/securityAlert.js";
import type { UserRole } from "common/auth";

function harVerifisertSecondFactor(req: Request): boolean {
  const secondFactorAge = req.clerkFactorVerificationAge?.[1];
  return (
    typeof secondFactorAge === "number" && Number.isFinite(secondFactorAge) && secondFactorAge >= 0
  );
}

/**
 * RBAC-guard som krever at `req.actorRole` er i listen av tillatte roller.
 *
 * Returnerer en Express-middleware som svarer 401/403 ved avvik og auditerer hendelsen.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  const set = new Set(allowedRoles);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.id) {
      apiError.unauthorized(res, "Påkrevd innlogging");
      return;
    }
    const role = req.actorRole ?? "user";
    if (!set.has(role)) {
      await audit({
        actorUserId: req.user.id,
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        category: "security",
        outcome: "failure",
        role,
        metadata: { allowedRoles: [...allowedRoles], path: req.path },
        req,
      });
      void checkSecurityThresholds({
        type: "rbac_abuse",
        key: req.user.id,
        actorUserId: req.user.id,
        ip: req.ip ?? req.socket?.remoteAddress,
        metadata: { path: req.path },
      });
      apiError.forbidden(res, "Manglende tilgang for denne rollen");
      return;
    }

    if (role === "admin" && set.has("admin") && !harVerifisertSecondFactor(req)) {
      await audit({
        actorUserId: req.user.id,
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        category: "security",
        outcome: "failure",
        role,
        metadata: {
          reason: "admin_mfa_required",
          allowedRoles: [...allowedRoles],
          path: req.path,
          factorVerificationAge: req.clerkFactorVerificationAge ?? null,
        },
        req,
      });
      void checkSecurityThresholds({
        type: "rbac_abuse",
        key: req.user.id,
        actorUserId: req.user.id,
        ip: req.ip ?? req.socket?.remoteAddress,
        metadata: { path: req.path, reason: "admin_mfa_required" },
      });
      res.status(403).json({
        error: "mfa_required",
        kode: "mfa_required",
        melding:
          "Admin-tilgang krever en sesjon med verifisert tofaktorautentisering. Logg inn på nytt og fullfør MFA.",
      });
      return;
    }

    next();
  };
}

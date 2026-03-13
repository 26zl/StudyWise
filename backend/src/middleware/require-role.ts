/**
 * RBAC: krever én av de tillatte rollene. Må kjøres etter requireAuth (req.actorRole satt).
 */
import type { Request, Response, NextFunction } from "express";
import { apiError } from "../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import type { UserRole } from "common/auth";

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
      apiError.forbidden(res, "Manglende tilgang for denne rollen");
      return;
    }
    next();
  };
}

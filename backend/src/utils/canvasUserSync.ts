/**
 * Hjelpere for å mappe Canvas-API-bruker til CanvasUser-modellen lokalt.
 */

import type { CanvasUser as CanvasProfile } from "common/canvas";
import type mongoose from "mongoose";

export function buildCanvasUserPayload(
  canvasUser: CanvasProfile,
  canvasBaseUrl: string,
  localUser: mongoose.Types.ObjectId | string,
) {
  return {
    canvasId: canvasUser.id,
    canvasBaseUrl,
    name: canvasUser.name,
    sortableName: canvasUser.sortable_name ?? undefined,
    shortName: canvasUser.short_name ?? undefined,
    avatarUrl: canvasUser.avatar_url ?? undefined,
    firstName: canvasUser.first_name ?? undefined,
    lastName: canvasUser.last_name ?? undefined,
    locale: canvasUser.locale ?? undefined,
    effectiveLocale: canvasUser.effective_locale ?? undefined,
    permissions: {
      canUpdateName: canvasUser.permissions?.can_update_name ?? false,
      canUpdateAvatar: canvasUser.permissions?.can_update_avatar ?? false,
      limitParentAppWebAccess: canvasUser.permissions?.limit_parent_app_web_access ?? false,
    },
    canvasUserCreatedAt: canvasUser.created_at ? new Date(canvasUser.created_at) : undefined,
    localUser,
  };
}

export function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

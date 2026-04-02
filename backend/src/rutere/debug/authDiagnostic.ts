/**
 * Auth-diagnostikk-rute (kun dev, env-styrt)
 *
 * GET /api/debug/auth-diagnostic
 * Returnerer diagnostikkdata om gjeldende autentisert bruker, indekser og potensielle duplikater.
 *
 * Krever: NODE_ENV !== "production" OG ENABLE_AUTH_DIAGNOSTICS=true
 */

import { Router, type Request, type Response } from "express";
import { User, sanitizeUsername } from "../../database/models/User.js";
import { logger } from "../../utils/logger.js";
import { isProd } from "../../utils/env.js";
import { findOrCreateUserByClerkId } from "../auth/clerkAuth.js";
import { isMongoDuplicateKeyError } from "../../utils/canvasUserSync.js";

const router = Router();
/** Egen ruter for uautentiserte test-endepunkter (monteres før global requireAuth). */
const testAuthFlowRouter = Router();

/** Dobbel sjekk: ikke-prod OG eksplisitt miljøvariabel-flagg. */
function isDiagnosticsEnabled(): boolean {
  if (isProd) return false;
  return process.env.ENABLE_AUTH_DIAGNOSTICS === "true";
}

/** Trygg brukerprojeksjon — eksponerer aldri tokens, kun identitet og metadata-felt. */
function safeUserProjection(u: {
  _id: unknown;
  clerkId?: string;
  email?: string;
  username?: string;
  authProvider?: string;
  deletedAt?: Date;
  createdAt?: Date;
}) {
  return {
    _id: u._id,
    clerkId: u.clerkId,
    email: u.email,
    username: u.username,
    authProvider: u.authProvider,
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
  };
}

function isUserLikeResult(
  value: unknown,
): value is {
  _id: unknown;
  clerkId?: string;
  email?: string;
  username?: string;
  authProvider?: string;
  deletedAt?: Date;
  createdAt?: Date;
} {
  return typeof value === "object" && value !== null && "_id" in value;
}

function classifyConflictResult(value: unknown): {
  type:
    | "accountConflict"
    | "userDeleted"
    | "oauthAccountConflict"
    | "oauthMetadataMissing"
    | "usernameConflict";
  payload: unknown;
} | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  if ("__accountConflict" in value) {
    return {
      type: "accountConflict",
      payload: { __accountConflict: true },
    };
  }

  if ("__userDeleted" in value) {
    return {
      type: "userDeleted",
      payload: { __userDeleted: true },
    };
  }

  if ("__oauthAccountConflict" in value) {
    const oauth = value as {
      __oauthAccountConflict: true;
      provider?: string;
      conflictingUserId?: string;
    };
    return {
      type: "oauthAccountConflict",
      payload: {
        __oauthAccountConflict: true,
        provider: oauth.provider,
        conflictingUserId: oauth.conflictingUserId,
      },
    };
  }

  if ("__oauthMetadataMissing" in value) {
    const oauth = value as {
      __oauthMetadataMissing: true;
      provider?: string;
    };
    return {
      type: "oauthMetadataMissing",
      payload: {
        __oauthMetadataMissing: true,
        provider: oauth.provider,
      },
    };
  }

  if ("__usernameConflict" in value) {
    const username = value as {
      __usernameConflict: true;
      username?: string;
    };
    return {
      type: "usernameConflict",
      payload: {
        __usernameConflict: true,
        username: username.username,
      },
    };
  }

  return null;
}

router.get("/auth-diagnostic", async (req: Request, res: Response) => {
  if (!isDiagnosticsEnabled()) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Ikke autentisert" });
    }

    // Current user — include usernameNormalized (hidden by select:false)
    // Velger IKKE +canvasApiToken — ikke nødvendig for diagnostikk
    const currentUser = await User.findById(userId).select("+usernameNormalized");
    if (!currentUser) {
      return res.status(404).json({ error: "Bruker ikke funnet" });
    }

    // Email duplicates for current user
    const emailDupes = await User.find({ email: currentUser.email })
      .select("_id clerkId email username authProvider deletedAt createdAt");

    // Brukernavn-duplikater for nåværende bruker
    let usernameDupes: typeof emailDupes = [];
    if (currentUser.username) {
      const normalized = currentUser.username.toLowerCase().trim();
      usernameDupes = await User.find({ usernameNormalized: normalized })
        .select("_id clerkId email username authProvider deletedAt createdAt");
    }

    // ClerkId duplicates
    let clerkIdDupes: typeof emailDupes = [];
    if (currentUser.clerkId) {
      clerkIdDupes = await User.find({ clerkId: currentUser.clerkId })
        .select("_id clerkId email username authProvider deletedAt createdAt");
    }

    // Index verification
    const indexes = await User.collection.indexes();
    const requiredNames = [
      "email_1",
      "clerk_id_unique",
      "username_normalized_unique",
      "oauth_accounts_provider_account_id_unique",
    ];
    const indexSummary = indexes.map((idx) => ({
      name: idx.name,
      key: idx.key,
      unique: idx.unique ?? false,
      sparse: idx.sparse ?? false,
    }));
    const existingNames = new Set(indexes.map((idx) => idx.name));
    const missingIndexes = requiredNames.filter((n) => !existingNames.has(n));

    // Stats
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ deletedAt: { $exists: false } });

    // Global email duplicates (active only)
    const emailDuplicateAggregation = await User.aggregate([
      { $match: { deletedAt: { $exists: false } } },
      { $group: { _id: "$email", count: { $sum: 1 }, ids: { $push: { $toString: "$_id" } } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ]);

    // Global username duplicates (active only)
    const usernameDuplicateAggregation = await User.aggregate([
      { $match: { deletedAt: { $exists: false }, usernameNormalized: { $exists: true, $ne: null } } },
      { $group: { _id: "$usernameNormalized", count: { $sum: 1 }, ids: { $push: { $toString: "$_id" } } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ]);

    const diagnostic = {
      currentUser: {
        _id: currentUser._id,
        clerkId: currentUser.clerkId,
        email: currentUser.email,
        username: currentUser.username,
        usernameNormalized: (currentUser as unknown as Record<string, unknown>).usernameNormalized,
        authProvider: currentUser.authProvider,
        deletedAt: currentUser.deletedAt,
        createdAt: currentUser.createdAt,
        oauthAccountCount: currentUser.oauthAccounts?.length ?? 0,
      },
      emailDuplicatesForCurrentUser: emailDupes.map(safeUserProjection),
      usernameDuplicatesForCurrentUser: usernameDupes.map(safeUserProjection),
      clerkIdDuplicatesForCurrentUser: clerkIdDupes.map(safeUserProjection),
      globalDuplicates: {
        emailDuplicates: emailDuplicateAggregation,
        usernameDuplicates: usernameDuplicateAggregation,
      },
      indexes: indexSummary,
      missingIndexes,
      stats: { totalUsers, activeUsers },
    };

    logger.info(
      { userId, emailDupeCount: emailDupes.length, usernameDupeCount: usernameDupes.length },
      "Auth-diagnostikk utført",
    );

    return res.json(diagnostic);
  } catch (error) {
    logger.error({ err: error }, "Auth-diagnostikk feilet");
    return res.status(500).json({ error: "Feil ved diagnostikk" });
  }
});

/**
 * POST /api/debug/test-auth-flow
 *
 * Kaller findOrCreateUserByClerkId direkte med en gitt clerkId.
 * For testing av auth-flyt uten en ekte Clerk JWT-sesjon.
 *
 * Body: { clerkId: string, flowId?: string }
 * Dobbelt-sikret: kun dev + ENABLE_AUTH_DIAGNOSTICS=true
 */
testAuthFlowRouter.post("/test-auth-flow", async (req: Request, res: Response) => {
  if (!isDiagnosticsEnabled()) {
    return res.status(404).json({ error: "Not found" });
  }

  const { clerkId, flowId } = req.body as { clerkId?: string; flowId?: string };
  if (!clerkId || typeof clerkId !== "string") {
    return res.status(400).json({ error: "clerkId is required" });
  }

  try {
    const result = await findOrCreateUserByClerkId(clerkId, { flowId });

    // Klassifiser resultatet
    let classification: string;
    let resultData: unknown;

    if (result === null) {
      classification = "null — findOrCreateUserByClerkId returned null";
      resultData = null;
    } else if (isUserLikeResult(result)) {
      // IUser — successful
      classification = "success — user found or created";
      resultData = safeUserProjection(result);
    } else {
      const conflict = classifyConflictResult(result);
      if (conflict) {
        classification = `conflict_or_error — type: ${conflict.type}`;
        resultData = conflict.payload;
      } else {
        classification = "unknown_result_shape";
        resultData = result;
      }
    }

    logger.info({ clerkId, flowId, classification }, "test-auth-flow utført");
    return res.json({ classification, result: resultData });
  } catch (error) {
    logger.error({ err: error, clerkId, flowId }, "test-auth-flow feilet");
    return res.status(500).json({ error: "Feil ved test-auth-flow" });
  }
});

/**
 * POST /api/debug/test-update-profile
 *
 * Tester brukernavn-oppdatering og konfliktdeteksjon ved å prøve å oppdatere brukerens brukernavn.
 * Brukes av auth matrix-testene for å verifisere 409 Conflict-håndtering.
 *
 * Body: { clerkId: string, newUsername: string, flowId?: string }
 * Dobbelt-sikret: kun dev + ENABLE_AUTH_DIAGNOSTICS=true
 *
 * Returnerer:
 * - 200 { success: true, user: {...} } ved vellykket oppdatering
 * - 409 { error: "username_conflict", ... } hvis brukernavnet er tatt
 * - 400 { error: "invalid_username" } hvis brukernavnformat er ugyldig
 * - 404 { error: "user_not_found" } hvis clerkId ikke matcher noen bruker
 */
testAuthFlowRouter.post("/test-update-profile", async (req: Request, res: Response) => {
  if (!isDiagnosticsEnabled()) {
    return res.status(404).json({ error: "Not found" });
  }

  const { clerkId, newUsername, flowId } = req.body as {
    clerkId?: string;
    newUsername?: string;
    flowId?: string;
  };

  if (!clerkId || typeof clerkId !== "string") {
    return res.status(400).json({ error: "clerkId is required" });
  }
  if (!newUsername || typeof newUsername !== "string") {
    return res.status(400).json({ error: "newUsername is required" });
  }

  try {
    // Finn brukeren etter clerkId
    const user = await User.findOne({ clerkId, deletedAt: { $exists: false } });
    if (!user) {
      logger.info({ clerkId, flowId }, "test-update-profile: user not found");
      return res.status(404).json({ error: "user_not_found", clerkId });
    }

    // Valider og sanitér det nye brukernavnet
    const sanitized = sanitizeUsername(newUsername);
    if (!sanitized) {
      logger.info({ clerkId, flowId, newUsername }, "test-update-profile: invalid username");
      return res.status(400).json({ error: "invalid_username", username: newUsername });
    }

    // Sjekk om brukernavnet allerede er tatt av en annen bruker
    const existingUser = await User.findOne({
      usernameNormalized: sanitized.usernameNormalized,
      _id: { $ne: user._id },
      deletedAt: { $exists: false },
    }).select("_id email username");

    if (existingUser) {
      logger.info(
        { clerkId, flowId, newUsername, conflictingUserId: existingUser._id },
        "test-update-profile: username conflict detected (early check)"
      );
      return res.status(409).json({
        error: "username_conflict",
        melding: `Brukernavnet "${newUsername}" er allerede tatt.`,
        username: newUsername,
        conflictingUserId: existingUser._id,
        detectionPhase: "early_check",
      });
    }

    // Forsøk oppdatering
    try {
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            username: sanitized.username,
            usernameNormalized: sanitized.usernameNormalized,
          },
        },
        { returnDocument: "after" }
      );

      logger.info({ clerkId, flowId, newUsername }, "test-update-profile: success");
      return res.json({
        success: true,
        user: updatedUser ? safeUserProjection(updatedUser) : null,
      });
    } catch (error) {
      // Håndter race condition der brukernavnet ble tatt mellom sjekk og oppdatering
      if (isMongoDuplicateKeyError(error)) {
        logger.info(
          { clerkId, flowId, newUsername },
          "test-update-profile: username conflict detected (db fallback)"
        );
        return res.status(409).json({
          error: "username_conflict",
          melding: `Brukernavnet "${newUsername}" er allerede tatt.`,
          username: newUsername,
          detectionPhase: "db_fallback",
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error({ err: error, clerkId, flowId }, "test-update-profile feilet");
    return res.status(500).json({ error: "Feil ved test-update-profile" });
  }
});

export { testAuthFlowRouter };
export default router;

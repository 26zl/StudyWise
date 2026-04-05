/**
 * Clerk Webhook — fanger `user.deleted`-hendelser fra Clerk.
 * Rydder opp StudyWise-data hvis en bruker slettes direkte via Clerk
 * (f.eks. via Clerk Dashboard eller Clerk sin innebygde UI).
 *
 * Signaturverifisering følger Svix-standarden som Clerk bruker:
 * https://docs.svix.com/receiving/verifying-payloads/how
 */
import crypto from "crypto";
import express from "express";
import { User } from "../../database/models/User.js";
import { deleteAccountData } from "./kontoSlett.js";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { rateLimitClerkWebhook } from "../../middleware/rate-limit.js";
import { getCache, setCache, isRedisReady } from "../../cache/redis.js";

const router = express.Router();

// Rate limiting på webhook-endepunktet
router.use(rateLimitClerkWebhook);

// Svix signerer med base64-encoded secret som starter med "whsec_"
function getWebhookSecret(): string | null {
  const raw = process.env.CLERK_WEBHOOK_SECRET?.trim();
  if (!raw) return null;
  return raw;
}

// Replay-beskyttelse: lagre behandlede svix-id-er i Redis (6 min TTL > 5 min tidsvindu)
const WEBHOOK_DEDUPE_PREFIX = "webhook:svix:";
const WEBHOOK_DEDUPE_TTL_S = 360;

async function isReplayedEvent(svixId: string): Promise<boolean> {
  if (!isRedisReady()) return false; // Tillat gjennomgang hvis Redis er nede
  const existing = await getCache(`${WEBHOOK_DEDUPE_PREFIX}${svixId}`);
  return existing !== null;
}

async function markEventProcessed(svixId: string): Promise<void> {
  if (!isRedisReady()) return;
  await setCache(`${WEBHOOK_DEDUPE_PREFIX}${svixId}`, "1", WEBHOOK_DEDUPE_TTL_S);
}

/**
 * Verifiserer Svix webhook-signatur.
 * Clerk/Svix bruker HMAC-SHA256 med base64-encoded nøkkel.
 */
function verifySvixSignature(
  payload: string,
  headers: {
    svixId: string | undefined;
    svixTimestamp: string | undefined;
    svixSignature: string | undefined;
  },
  secret: string,
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Sjekk at timestamp ikke er for gammelt (5 min toleranse)
  const timestampSec = Number(svixTimestamp);
  if (!Number.isFinite(timestampSec)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSec) > 300) return false;

  // Svix secret starter med "whsec_" — fjern prefixet og decode base64
  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64",
  );

  // Signaturen beregnes over: "<msg_id>.<timestamp>.<body>"
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Svix sender flere signaturer separert med mellomrom, hver med "v1," prefix
  const expectedBuf = Buffer.from(expectedSignature);
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const [version, value] = sig.split(",");
    if (version !== "v1" || !value) continue;

    const actualBuf = Buffer.from(value);
    // timingSafeEqual krever lik lengde — ulik lengde betyr ugyldig signatur
    if (actualBuf.length !== expectedBuf.length) continue;

    if (crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * POST /api/clerk-webhook
 * Mottar webhook-hendelser fra Clerk. Krever CLERK_WEBHOOK_SECRET.
 * Body parses som raw text for signaturverifisering.
 */
router.post("/", async (req, res) => {
  const secret = getWebhookSecret();
  if (!secret) {
    logger.warn("Clerk webhook mottatt, men CLERK_WEBHOOK_SECRET er ikke satt");
    res.status(500).json({ error: "Webhook ikke konfigurert" });
    return;
  }

  // Body er alltid Buffer pga. express.raw({ type: "application/json" }) montert i index.ts
  if (!Buffer.isBuffer(req.body)) {
    logger.warn("Clerk webhook: forventet Buffer-body fra express.raw()");
    res.status(400).json({ error: "Ugyldig payload-format" });
    return;
  }
  const rawBuffer: Buffer = Buffer.from(req.body);
  const payload = rawBuffer.toString("utf-8");

  const isValid = verifySvixSignature(payload, {
    svixId: req.headers["svix-id"] as string | undefined,
    svixTimestamp: req.headers["svix-timestamp"] as string | undefined,
    svixSignature: req.headers["svix-signature"] as string | undefined,
  }, secret);

  if (!isValid) {
    logger.warn("Clerk webhook: ugyldig signatur");
    res.status(401).json({ error: "Ugyldig signatur" });
    return;
  }

  // Replay-beskyttelse: avvis allerede behandlede hendelser basert på svix-id
  const svixId = req.headers["svix-id"] as string;
  if (await isReplayedEvent(svixId)) {
    logger.info({ svixId }, "Clerk webhook: duplikat hendelse avvist (replay)");
    res.json({ received: true });
    return;
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    logger.warn("Clerk webhook: ugyldig JSON");
    res.status(400).json({ error: "Ugyldig payload" });
    return;
  }

  if (event.type !== "user.deleted") {
    // Ignorer andre hendelser — returner 200 for å unngå retries
    res.json({ received: true });
    return;
  }

  const clerkId = typeof event.data.id === "string" ? event.data.id : null;
  if (!clerkId) {
    logger.warn({ event }, "Clerk webhook user.deleted: mangler clerkId");
    res.status(400).json({ error: "Mangler bruker-ID" });
    return;
  }

  // Finn lokal bruker basert på clerkId
  const user = await User.findOne({ clerkId }).select("_id");
  if (!user) {
    logger.info(
      { clerkId },
      "Clerk webhook user.deleted: ingen lokal bruker funnet — allerede slettet via StudyWise",
    );
    res.json({ received: true });
    return;
  }

  const userId = user._id.toString();
  logger.info(
    { clerkId, userId },
    "Clerk webhook user.deleted: starter opprydding av StudyWise-data",
  );

  try {
    // skipClerkDeletion: Clerk-brukeren er allerede slettet (webhooken trigges av det)
    const result = await deleteAccountData(userId, { skipClerkDeletion: true });

    await audit({
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "success",
      actorUserId: `webhook:${clerkId}`,
      metadata: {
        kilde: "clerk_webhook",
        clerkId,
        slettetData: result.deleted,
        vectorCleanupSucceeded: result.vectorCleanupSucceeded,
      },
    });

    // Marker hendelsen som behandlet for replay-beskyttelse
    await markEventProcessed(svixId);

    logger.info(
      { clerkId, userId, result: result.deleted },
      "Clerk webhook user.deleted: StudyWise-data ryddet opp",
    );

    res.json({ received: true });
  } catch (err) {
    logger.error(
      { err, clerkId, userId },
      "Clerk webhook user.deleted: feil under opprydding",
    );
    // Returner 500 slik at Clerk prøver på nytt
    res.status(500).json({ error: "Opprydding feilet" });
  }
});

export const clerkWebhookRouter = router;

/*
 * Tester for Svix webhook signaturverifisering.
 * Dekker: gyldig signatur, ugyldig signatur, gamle/framtidige timestamps,
 * manglende headers, og timing-safe sammenligning.
 */

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

// verifySvixSignature importeres via mock-fri rute. Webhook-routeren krever
// express-routeren kjørt; vi mocker kun logger for å unngå støy.
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock øvrige tunge avhengigheter importert av clerkWebhook.ts slik at
// modulen kan lastes uten å slå på Mongo/Redis-oppsett.
vi.mock("../../../cache/redis.js", () => ({
  setCache: vi.fn(),
  setCacheNX: vi.fn(),
  isRedisReady: () => false,
}));
vi.mock("../../../database/models/User.js", () => ({ User: {} }));
vi.mock("../../../rutere/auth/kontoSlett.js", () => ({
  deleteAccountData: vi.fn(),
}));
vi.mock("../../../utils/auditLog.js", () => ({
  audit: vi.fn(),
  anonymizeAuditTrailForDeletedUser: vi.fn(),
  AUDIT_ACTIONS: { ACCOUNT_DELETED: "account_deleted" },
}));
vi.mock("../../../middleware/rate-limit.ts", () => ({
  rateLimitClerkWebhook: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { verifySvixSignature } from "../../../rutere/auth/clerkWebhook.js";

/** Bygg en gyldig Svix-signatur for gitt payload, id, timestamp og secret. */
function lagGyldigSignatur(
  payload: string,
  svixId: string,
  timestamp: string,
  secret: string,
): string {
  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64",
  );
  const signedContent = `${svixId}.${timestamp}.${payload}`;
  const sig = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  return `v1,${sig}`;
}

describe("verifySvixSignature", () => {
  const SECRET = `whsec_${Buffer.from("testnokkel-for-svix-32bytes!!", "utf-8").toString("base64")}`;
  const PAYLOAD = JSON.stringify({ type: "user.deleted", data: { id: "user_abc" } });
  const svixId = "msg_123";
  const nowSec = () => Math.floor(Date.now() / 1000).toString();

  it("godtar gyldig signatur med korrekt secret, id, timestamp og payload", () => {
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: ts, svixSignature: sig }, SECRET),
    ).toBe(true);
  });

  it("godtar secret uten whsec_-prefiks", () => {
    const bareSecret = SECRET.slice(6); // fjern "whsec_"
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, bareSecret);
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: ts, svixSignature: sig }, bareSecret),
    ).toBe(true);
  });

  it("avviser når secret er feil", () => {
    const ts = nowSec();
    const wrongSecret = `whsec_${Buffer.from("annen-nokkel-helt-feil-xxxxxxx", "utf-8").toString("base64")}`;
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, wrongSecret);
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: ts, svixSignature: sig }, SECRET),
    ).toBe(false);
  });

  it("avviser når payload er tuklet med", () => {
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    const tuklet = PAYLOAD.replace("user_abc", "user_XYZ");
    expect(
      verifySvixSignature(tuklet, { svixId, svixTimestamp: ts, svixSignature: sig }, SECRET),
    ).toBe(false);
  });

  it("avviser timestamp mer enn 5 minutter gammelt", () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 301).toString();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, oldTs, SECRET);
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: oldTs, svixSignature: sig }, SECRET),
    ).toBe(false);
  });

  it("avviser timestamp mer enn 5 minutter fram i tid", () => {
    const futureTs = (Math.floor(Date.now() / 1000) + 301).toString();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, futureTs, SECRET);
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: futureTs, svixSignature: sig },
        SECRET,
      ),
    ).toBe(false);
  });

  it("avviser ikke-numerisk timestamp", () => {
    const ts = "ikke-et-tall";
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: ts, svixSignature: sig }, SECRET),
    ).toBe(false);
  });

  it("avviser når svixId mangler", () => {
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId: undefined, svixTimestamp: ts, svixSignature: sig },
        SECRET,
      ),
    ).toBe(false);
  });

  it("avviser når svixTimestamp mangler", () => {
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: undefined, svixSignature: sig },
        SECRET,
      ),
    ).toBe(false);
  });

  it("avviser når svixSignature mangler", () => {
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: nowSec(), svixSignature: undefined },
        SECRET,
      ),
    ).toBe(false);
  });

  it("godtar når én av flere signaturer matcher", () => {
    const ts = nowSec();
    const gyldig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    const mangeSigs = `v1,ugyldig== ${gyldig} v1,ogsaaugyldig==`;
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: ts, svixSignature: mangeSigs },
        SECRET,
      ),
    ).toBe(true);
  });

  it("ignorerer signaturer med feil versjon", () => {
    const ts = nowSec();
    const sig = lagGyldigSignatur(PAYLOAD, svixId, ts, SECRET);
    const v2 = sig.replace("v1,", "v2,");
    expect(
      verifySvixSignature(PAYLOAD, { svixId, svixTimestamp: ts, svixSignature: v2 }, SECRET),
    ).toBe(false);
  });

  it("avviser signaturer med ulik lengde (timing-safe)", () => {
    const ts = nowSec();
    const kortSig = "v1,kort";
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: ts, svixSignature: kortSig },
        SECRET,
      ),
    ).toBe(false);
  });

  it("avviser signatur uten komma-separator", () => {
    const ts = nowSec();
    expect(
      verifySvixSignature(
        PAYLOAD,
        { svixId, svixTimestamp: ts, svixSignature: "bare-tull" },
        SECRET,
      ),
    ).toBe(false);
  });
});

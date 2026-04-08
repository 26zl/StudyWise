/**
 * Kryssmiljø re-link guard: hindrer ping-pong mellom dev- og prod-Clerk når
 * samme MongoDB-bruker er aktiv i begge instanser samtidig (typisk
 * utvikler-scenario hvor Mongo deles mellom dev og prod).
 *
 * - Ved relink innenfor cooldown blokkerer vi og lar fanen falle tilbake til
 *   normal konfliktfeil (som AuthConflictGuard fanger og tvinger logout på).
 * - I ikke-prod blokkerer vi i tillegg all cross-env relink uansett cooldown
 *   (dev-gate): utvikler må logge ut manuelt i den ene instansen først.
 * - Vi logger WARN med teller slik at ping-pong er synlig i Datadog.
 */

import { getCache, setCache } from "../../cache/redis.js";
import { isProd } from "../../utils/env.js";

export const RELINK_STATE_KEY_PREFIX = "auth:relink-state:";
export const RELINK_STATE_TTL_SECONDS = 300;
export const RELINK_COOLDOWN_MS = 10_000;

export type ClerkEnv = "test" | "live" | "unknown";

export type RelinkState = {
  at: number;
  clerkId: string;
  env: ClerkEnv;
  count: number;
};

export type GuardRelinkResult =
  | { blocked: true; reason: "dev_gate_env_mismatch" | "rate_limited_ping_pong"; count: number }
  | { blocked: false };

type GuardRelinkOptions = {
  previousClerkEnv?: ClerkEnv | null;
};

export function getCurrentClerkEnv(): ClerkEnv {
  const key = process.env.CLERK_SECRET_KEY ?? "";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "unknown";
}

export async function getRelinkState(userId: string): Promise<RelinkState | null> {
  const raw = await getCache(`${RELINK_STATE_KEY_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RelinkState;
  } catch {
    return null;
  }
}

export async function setRelinkState(userId: string, state: RelinkState): Promise<void> {
  await setCache(
    `${RELINK_STATE_KEY_PREFIX}${userId}`,
    JSON.stringify(state),
    RELINK_STATE_TTL_SECONDS,
  );
}

function shouldBlockForDevGate(
  previousClerkEnv: ClerkEnv | null | undefined,
  currentEnv: ClerkEnv,
): boolean {
  if (isProd) {
    return false;
  }

  // Per-utvikler opt-out: når en utvikler bevisst deler én Mongo + samme
  // ENCRYPTION_KEY mellom lokal dev og prod, blir dev-gate bare friksjon.
  // Flagget settes kun i utviklerens egen lokale .env (aldri i .env.example
  // eller CI), så andre på teamet beholder beskyttelsen.
  // Cooldown-vernet (rate_limited_ping_pong) er fortsatt aktivt.
  if (process.env.RELINK_DEV_GATE_DISABLED === "true") {
    return false;
  }

  // Hvis vi ikke sikkert vet at gammel og ny clerkId tilhører samme miljø,
  // blokkerer vi i ikke-prod. Det er tryggere enn å relinke på delt Mongo.
  return previousClerkEnv !== currentEnv || currentEnv === "unknown";
}

/**
 * Sjekker om en relink skal tillates. Oppdaterer Redis-state som sideeffekt
 * (både ved tillatt og blokkert utfall, slik at teller og cooldown holdes i sync).
 */
export async function guardRelink(
  existingUserId: string,
  newClerkUserId: string,
  options?: GuardRelinkOptions,
): Promise<GuardRelinkResult> {
  const now = Date.now();
  const currentEnv = getCurrentClerkEnv();
  const prior = await getRelinkState(existingUserId);
  const previousClerkEnv = options?.previousClerkEnv ?? null;

  if (!prior) {
    if (shouldBlockForDevGate(previousClerkEnv, currentEnv)) {
      await setRelinkState(existingUserId, {
        at: now,
        clerkId: newClerkUserId,
        env: currentEnv,
        count: 1,
      });
      return { blocked: true, reason: "dev_gate_env_mismatch", count: 1 };
    }

    await setRelinkState(existingUserId, {
      at: now,
      clerkId: newClerkUserId,
      env: currentEnv,
      count: 1,
    });
    return { blocked: false };
  }

  const elapsed = now - prior.at;
  const withinCooldown = elapsed < RELINK_COOLDOWN_MS;
  const nextCount = withinCooldown ? prior.count + 1 : 1;
  const envMismatch = shouldBlockForDevGate(prior.env, currentEnv);

  // Dev-gate: blokker all cross-env relink i ikke-prod, uavhengig av cooldown.
  if (envMismatch) {
    await setRelinkState(existingUserId, {
      at: now,
      clerkId: newClerkUserId,
      env: currentEnv,
      count: nextCount,
    });
    return { blocked: true, reason: "dev_gate_env_mismatch", count: nextCount };
  }

  // Rate-limit: blokker hvis forrige relink var innenfor cooldown.
  if (withinCooldown) {
    await setRelinkState(existingUserId, {
      at: now,
      clerkId: newClerkUserId,
      env: currentEnv,
      count: nextCount,
    });
    return { blocked: true, reason: "rate_limited_ping_pong", count: nextCount };
  }

  // OK — oppdater state og tillat.
  await setRelinkState(existingUserId, {
    at: now,
    clerkId: newClerkUserId,
    env: currentEnv,
    count: 1,
  });
  return { blocked: false };
}

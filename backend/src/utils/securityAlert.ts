/**
 * In-memory sikkerhetsvarsling: oppdager mistenkelige mønster (brute force, RBAC-misbruk, admin storm)
 * via sliding window over audit-hendelser, og logger til audit + Pino.
 */
import { logger } from "./logger.js";
import { audit, AUDIT_ACTIONS } from "./auditLog.js";

// Konfigurasjon
interface ThresholdConfig {
  /** Maks antall hendelser før alarm */
  maxEvents: number;
  /** Tidsvindu i millisekunder */
  windowMs: number;
  /** Beskrivelse for logg */
  description: string;
}

const THRESHOLDS: Record<string, ThresholdConfig> = {
  brute_force: {
    maxEvents: 10,
    windowMs: 5 * 60 * 1000,
    description: "Brute force: mange auth-feil fra samme IP",
  },
  rbac_abuse: {
    maxEvents: 5,
    windowMs: 10 * 60 * 1000,
    description: "RBAC-misbruk: gjentatte tilgangsnektelser fra samme bruker",
  },
  admin_storm: {
    maxEvents: 20,
    windowMs: 5 * 60 * 1000,
    description: "Admin storm: uvanlig mange admin-handlinger fra samme bruker",
  },
};

// Sliding window
/** Map<nøkkel, timestamps[]> for sliding window-tracking */
const windows = new Map<string, number[]>();

/** Maks antall nøkler i minnet for å unngå minnelekkasje */
const MAX_KEYS = 10_000;

function pruneWindow(key: string, windowMs: number, now: number): number[] {
  const timestamps = windows.get(key) ?? [];
  const cutoff = now - windowMs;
  const pruned = timestamps.filter((ts) => ts > cutoff);
  if (pruned.length === 0) {
    windows.delete(key);
    return pruned;
  }
  windows.set(key, pruned);
  return pruned;
}

// Offentlig API
export interface SecurityEvent {
  type: "brute_force" | "rbac_abuse" | "admin_storm";
  /** Identifikator for gruppereing (IP for brute_force, userId for andre) */
  key: string;
  /** Bruker-ID for audit */
  actorUserId?: string;
  /** IP for kontekst */
  ip?: string;
  /** Ekstra metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Registrer en sikkerhetshendelse og sjekk om terskelen er nådd.
 * Returnerer true hvis en sikkerhetsalarm ble utløst.
 */
export async function checkSecurityThresholds(event: SecurityEvent): Promise<boolean> {
  const config = THRESHOLDS[event.type];
  if (!config) return false;

  const windowKey = `${event.type}:${event.key}`;
  const now = Date.now();

  // Begrens antall nøkler
  if (!windows.has(windowKey) && windows.size >= MAX_KEYS) {
    return false;
  }

  const timestamps = pruneWindow(windowKey, config.windowMs, now);
  timestamps.push(now);
  windows.set(windowKey, timestamps);

  if (timestamps.length < config.maxEvents) {
    return false;
  }

  // Terskel nådd — logg sikkerhetsvarsel
  logger.warn(
    {
      security_event: true,
      alertType: event.type,
      key: event.key,
      count: timestamps.length,
      windowMs: config.windowMs,
      ip: event.ip,
      actorUserId: event.actorUserId,
      ...event.metadata,
    },
    `SECURITY ALERT: ${config.description} (${timestamps.length} hendelser på ${config.windowMs / 1000}s)`,
  );

  // Skriv til audit-log for admin-panelet
  await audit({
    actorUserId: event.actorUserId ?? event.key,
    action: AUDIT_ACTIONS.SECURITY_ALERT,
    category: "security",
    outcome: "failure",
    metadata: {
      alertType: event.type,
      key: event.key,
      count: timestamps.length,
      windowMs: config.windowMs,
      description: config.description,
      ...event.metadata,
    },
  });

  // Tøm vinduet etter alarm for å unngå spam
  windows.delete(windowKey);
  return true;
}

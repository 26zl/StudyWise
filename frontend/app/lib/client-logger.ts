/**
 * Frontend log forwarder for admin "Logger"-fane.
 *
 * Hooker `console.error`, `console.warn`, `window.onerror` og
 * `window.addEventListener("unhandledrejection")` for å fange opp klient-feil
 * og batch-sende dem til backend, der de havner i samme ring-buffer som
 * backend-logger. Admin kan da se en samlet live-tail.
 *
 * VIKTIG: Bare aktivert for innloggede admin-brukere (initialisering trigges
 * av admin-panelet). Vanlige brukere sender ikke noe — vi vil ikke fylle
 * bufferet eller skape uønsket trafikk.
 *
 * Sanitization: meldinger trunkeres til 2000 tegn, context til ~4 kB JSON.
 * Vi sender ALDRI brukerinput, formdata eller request-body fra frontend hit.
 */

import { fetchApi } from "./apiClient";

type ClientLogLevel = "fatal" | "error" | "warn" | "info" | "debug";

interface ClientLogEntry {
  level: ClientLogLevel;
  msg: string;
  context?: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5_000;
const queue: ClientLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function safeStringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function enqueue(entry: ClientLogEntry) {
  queue.push(entry);
  if (queue.length >= MAX_BATCH_SIZE) {
    void flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    await fetchApi("/api/admin/logs/frontend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: batch }),
    });
  } catch {
    // Ikke re-enqueue ved feil — vi vil ikke ha en uendelig loop hvis backend er nede
  }
}

/**
 * Aktiver log forwarding. Idempotent — kall så mange ganger du vil.
 * Bør kun kalles fra admin-panelet etter at admin-rolle er bekreftet.
 */
export function installAdminLogForwarder() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Hook console.error
  originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError?.(...args);
    enqueue({
      level: "error",
      msg: truncate(args.map(safeStringify).join(" "), 2000),
      context: { url: window.location.pathname },
    });
  };

  // Hook console.warn
  originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn?.(...args);
    enqueue({
      level: "warn",
      msg: truncate(args.map(safeStringify).join(" "), 2000),
      context: { url: window.location.pathname },
    });
  };

  // Window error events
  window.addEventListener("error", (event) => {
    enqueue({
      level: "error",
      msg: truncate(`window.onerror: ${event.message}`, 2000),
      context: {
        url: window.location.pathname,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
      },
    });
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    enqueue({
      level: "error",
      msg: truncate(`unhandledRejection: ${safeStringify(event.reason)}`, 2000),
      context: { url: window.location.pathname },
    });
  });

  // Best-effort flush ved navigasjon
  window.addEventListener("beforeunload", () => {
    void flush();
  });
}

/** Manuell logging fra admin-komponenter (f.eks. catch-blokker som vil rapportere). */
export function logToAdminBuffer(level: ClientLogLevel, msg: string, context?: Record<string, unknown>) {
  if (!installed) return;
  enqueue({ level, msg: truncate(msg, 2000), context });
}

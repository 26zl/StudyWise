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
 * Sanitization: meldinger trunkeres, stacktraces sendes ikke videre og objekter
 * reduseres til trygge sammendrag før de legges i admin-bufferet.
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
let installCount = 0;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;
let windowErrorListener: ((event: ErrorEvent) => void) | null = null;
let unhandledRejectionListener:
  | ((event: PromiseRejectionEvent) => void)
  | null = null;
let beforeUnloadListener: (() => void) | null = null;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function sanitizeText(value: string): string {
  const utenLinjeskift = value.replace(/\s+/g, " ").trim();
  const utenEpost = utenLinjeskift.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[redacted-email]",
  );
  const utenUrlQuery = utenEpost.replace(/https?:\/\/\S+/gi, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "[redacted-url]";
    }
  });
  return truncate(utenUrlQuery, 600);
}

function summarizeObject(value: object): string {
  const constructorName = value.constructor?.name ?? "Object";
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) {
    return constructorName;
  }

  const visibleKeys = keys.slice(0, 5).join(",");
  const suffix = keys.length > 5 ? ",…" : "";
  return `${constructorName}{${visibleKeys}${suffix}}`;
}

function summarizeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeText(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Error) {
    return sanitizeText(`${value.name}: ${value.message}`);
  }
  if (value instanceof URL) {
    return sanitizeText(value.toString());
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === "object") {
    return summarizeObject(value);
  }
  try {
    return sanitizeText(String(value));
  } catch {
    return "[unserializable]";
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

function buildLogMessage(
  level: Extract<ClientLogLevel, "error" | "warn">,
  args: unknown[],
): string {
  const prefix = level === "error" ? "console.error" : "console.warn";
  const summary = args.map(summarizeValue).filter(Boolean).join(" ");
  return truncate(summary ? `${prefix}: ${summary}` : prefix, 2000);
}

function cleanupListeners() {
  if (typeof window === "undefined") return;

  if (windowErrorListener) {
    window.removeEventListener("error", windowErrorListener);
    windowErrorListener = null;
  }
  if (unhandledRejectionListener) {
    window.removeEventListener("unhandledrejection", unhandledRejectionListener);
    unhandledRejectionListener = null;
  }
  if (beforeUnloadListener) {
    window.removeEventListener("beforeunload", beforeUnloadListener);
    beforeUnloadListener = null;
  }
}

function uninstallAdminLogForwarder() {
  if (!installed) return;

  cleanupListeners();

  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }
  if (originalConsoleWarn) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
  }

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  installed = false;
  installCount = 0;
  void flush();
}

function releaseAdminLogForwarder() {
  installCount = Math.max(0, installCount - 1);
  if (installCount === 0) {
    uninstallAdminLogForwarder();
  }
}

/**
 * Aktiver log forwarding. Idempotent — kall så mange ganger du vil.
 * Bør kun kalles fra admin-panelet etter at admin-rolle er bekreftet.
 */
export function installAdminLogForwarder() {
  if (typeof window === "undefined") return () => {};
  installCount += 1;
  if (installed) {
    return releaseAdminLogForwarder;
  }

  installed = true;

  // Hook console.error
  originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError?.(...args);
    enqueue({
      level: "error",
      msg: buildLogMessage("error", args),
      context: { url: window.location.pathname },
    });
  };

  // Hook console.warn
  originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn?.(...args);
    enqueue({
      level: "warn",
      msg: buildLogMessage("warn", args),
      context: { url: window.location.pathname },
    });
  };

  // Window error events
  windowErrorListener = (event) => {
    enqueue({
      level: "error",
      msg: truncate(`window.onerror: ${sanitizeText(event.message)}`, 2000),
      context: {
        url: window.location.pathname,
        source: sanitizeText(event.filename),
        line: event.lineno,
        col: event.colno,
      },
    });
  };
  window.addEventListener("error", windowErrorListener);

  // Unhandled promise rejections
  unhandledRejectionListener = (event) => {
    enqueue({
      level: "error",
      msg: truncate(
        `unhandledRejection: ${summarizeValue(event.reason)}`,
        2000,
      ),
      context: { url: window.location.pathname },
    });
  };
  window.addEventListener("unhandledrejection", unhandledRejectionListener);

  // Best-effort flush ved navigasjon
  beforeUnloadListener = () => {
    void flush();
  };
  window.addEventListener("beforeunload", beforeUnloadListener);

  return releaseAdminLogForwarder;
}

/** Manuell logging fra admin-komponenter (f.eks. catch-blokker som vil rapportere). */
export function logToAdminBuffer(level: ClientLogLevel, msg: string, context?: Record<string, unknown>) {
  if (!installed) return;
  enqueue({ level, msg: truncate(msg, 2000), context });
}

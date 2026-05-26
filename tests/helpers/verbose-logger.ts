/**
 * Detaljert logger for autentiseringsmatrise-tester
 *
 * Tilbyr:
 * - Sanntids terminalutskrift med farger og tidsstempler
 * - Fillogging med sesjonsbaserte loggfiler
 * - Strukturert JSON-hendelseslogging
 * - Steg-for-steg synlighet i scenariokjøring
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "..", "auth", "results");
const LOGS_DIR = path.join(RESULTS_DIR, "logs");
const JSON_DIR = path.join(RESULTS_DIR, "json");
const SCREENSHOTS_DIR = path.join(RESULTS_DIR, "screenshots");

// ANSI-fargekoder
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

type LogLevel = "debug" | "info" | "step" | "success" | "warn" | "error" | "header";

interface LogEvent {
  timestamp: string;
  level: LogLevel;
  scenarioId?: string;
  flowId?: string;
  step?: string;
  message: string;
  data?: unknown;
}

interface VerboseLoggerOptions {
  runId: string;
  verbose?: boolean;
  logToFile?: boolean;
  logToJson?: boolean;
}

export class VerboseLogger {
  private runId: string;
  private verbose: boolean;
  private logToFile: boolean;
  private logToJson: boolean;
  private logFilePath: string;
  private jsonEvents: LogEvent[] = [];
  private currentScenarioId: string | null = null;
  private currentFlowId: string | null = null;
  private scenarioLogPaths: Map<string, string> = new Map();

  constructor(options: VerboseLoggerOptions) {
    this.runId = options.runId;
    this.verbose = options.verbose ?? true;
    this.logToFile = options.logToFile ?? true;
    this.logToJson = options.logToJson ?? true;

    this.ensureDirectories();
    this.logFilePath = path.join(LOGS_DIR, `run-${this.runId}.log`);
  }

  private ensureDirectories(): void {
    for (const dir of [RESULTS_DIR, LOGS_DIR, JSON_DIR, SCREENSHOTS_DIR]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private shortTime(): string {
    const now = new Date();
    return now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
  }

  private colorize(text: string, ...colors: string[]): string {
    return colors.join("") + text + COLORS.reset;
  }

  private levelColor(level: LogLevel): string {
    switch (level) {
      case "debug":
        return COLORS.dim;
      case "info":
        return COLORS.white;
      case "step":
        return COLORS.cyan;
      case "success":
        return COLORS.green;
      case "warn":
        return COLORS.yellow;
      case "error":
        return COLORS.red;
      case "header":
        return COLORS.bold + COLORS.magenta;
    }
  }

  private levelLabel(level: LogLevel): string {
    switch (level) {
      case "debug":
        return "DBG";
      case "info":
        return "INF";
      case "step":
        return "STP";
      case "success":
        return "OK ";
      case "warn":
        return "WRN";
      case "error":
        return "ERR";
      case "header":
        return "===";
    }
  }

  private writeToConsole(level: LogLevel, message: string, prefix?: string): void {
    const time = this.colorize(this.shortTime(), COLORS.dim);
    const label = this.colorize(`[${this.levelLabel(level)}]`, this.levelColor(level));
    const scenarioPrefix = prefix ? this.colorize(`[${prefix}]`, COLORS.blue) + " " : "";
    process.stdout.write(`${time} ${label} ${scenarioPrefix}${message}\n`);
  }

  private writeToFile(line: string): void {
    if (!this.logToFile) return;
    fs.appendFileSync(this.logFilePath, line + "\n", "utf8");
  }

  private writeToScenarioLog(scenarioId: string, line: string): void {
    if (!this.logToFile) return;
    let logPath = this.scenarioLogPaths.get(scenarioId);
    if (!logPath) {
      logPath = path.join(LOGS_DIR, `scenario-${scenarioId}-${this.runId}.log`);
      this.scenarioLogPaths.set(scenarioId, logPath);
    }
    fs.appendFileSync(logPath, line + "\n", "utf8");
  }

  private recordEvent(level: LogLevel, message: string, data?: unknown): void {
    if (!this.logToJson) return;
    const event: LogEvent = {
      timestamp: this.timestamp(),
      level,
      scenarioId: this.currentScenarioId ?? undefined,
      flowId: this.currentFlowId ?? undefined,
      message,
      data,
    };
    this.jsonEvents.push(event);
  }

  setScenario(scenarioId: string | null): void {
    this.currentScenarioId = scenarioId;
    this.currentFlowId = null;
  }

  setFlowId(flowId: string | null): void {
    this.currentFlowId = flowId;
  }

  getScenarioLogPath(scenarioId: string): string {
    return this.scenarioLogPaths.get(scenarioId) ?? "";
  }

  header(message: string): void {
    const separator = "=".repeat(60);
    const formatted = `\n${separator}\n  ${message}\n${separator}`;
    if (this.verbose) {
      process.stdout.write(this.colorize(formatted, COLORS.bold, COLORS.magenta) + "\n");
    }
    this.writeToFile(formatted);
    if (this.currentScenarioId) {
      this.writeToScenarioLog(this.currentScenarioId, formatted);
    }
    this.recordEvent("header", message);
  }

  debug(message: string, data?: unknown): void {
    if (!this.verbose) return;
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  step(stepName: string, details?: string): void {
    const message = details ? `${stepName}: ${details}` : stepName;
    this.log("step", message);
  }

  success(message: string, data?: unknown): void {
    this.log("success", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const prefix = this.currentScenarioId ?? undefined;
    const logLine = `[${this.timestamp()}] [${this.levelLabel(level)}] ${prefix ? `[${prefix}] ` : ""}${message}`;
    const dataLine = data !== undefined ? `  → ${JSON.stringify(data)}` : "";

    if (this.verbose || level === "error" || level === "warn" || level === "success") {
      this.writeToConsole(level, message, prefix);
      if (data !== undefined && this.verbose) {
        process.stdout.write(
          `  ${this.colorize("→", COLORS.dim)} ${JSON.stringify(data, null, 2)}\n`,
        );
      }
    }

    this.writeToFile(logLine + dataLine);
    if (this.currentScenarioId) {
      this.writeToScenarioLog(this.currentScenarioId, logLine + dataLine);
    }
    this.recordEvent(level, message, data);
  }

  // Detaljert bevislogging for scenariosteg
  logClerkCreate(
    label: string,
    result: {
      ok: boolean;
      user?: { id: string; email: string; username: string | null };
      error?: unknown;
    },
  ): void {
    if (result.ok && result.user) {
      this.success(`Clerk ${label} created`, {
        clerkId: result.user.id,
        email: result.user.email,
        username: result.user.username,
      });
    } else {
      this.warn(`Clerk ${label} creation failed`, result.error);
    }
  }

  logAuthFlow(label: string, response: { status: number; body: unknown }): void {
    this.step(`Auth flow ${label}`, `HTTP ${response.status}`);
    if (this.verbose) {
      this.debug("Flow response body", response.body);
    }
  }

  logDbSnapshot(snapshot: {
    available: boolean;
    emailMatches: unknown[];
    usernameMatches: unknown[];
    clerkIdMatches: unknown[];
  }): void {
    if (!snapshot.available) {
      this.warn("DB snapshot unavailable");
      return;
    }
    this.step(
      "DB snapshot captured",
      `emails=${snapshot.emailMatches.length}, usernames=${snapshot.usernameMatches.length}, clerkIds=${snapshot.clerkIdMatches.length}`,
    );
    if (this.verbose && (snapshot.emailMatches.length > 0 || snapshot.usernameMatches.length > 0)) {
      this.debug("DB matches", {
        emails: snapshot.emailMatches,
        usernames: snapshot.usernameMatches,
        clerkIds: snapshot.clerkIdMatches,
      });
    }
  }

  logClassification(classification: string): void {
    const isGood =
      classification.includes("BLOCKED") ||
      classification.includes("SAFE") ||
      classification === "TWO_DISTINCT_LOCAL_USERS";
    const isBad =
      classification.includes("DUPLICATE") ||
      classification.includes("BROKEN") ||
      classification.includes("FAILED");

    if (isGood) {
      this.success(`Classification: ${classification}`);
    } else if (isBad) {
      this.error(`Classification: ${classification}`);
    } else {
      this.info(`Classification: ${classification}`);
    }
  }

  logCleanup(deleted: string[], failed: string[]): void {
    if (deleted.length > 0) {
      this.step("Cleanup", `deleted ${deleted.length} Clerk user(s)`);
    }
    if (failed.length > 0) {
      this.warn("Cleanup failed", { failedDeletes: failed });
    }
  }

  // Skriv kombinerte JSON-hendelser
  writeJsonEvents(): string {
    const jsonPath = path.join(JSON_DIR, `events-${this.runId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(this.jsonEvents, null, 2), "utf8");
    return jsonPath;
  }

  // Oppsummeringsmetoder
  printSummary(totals: {
    total: number;
    executed: number;
    manualRequired: number;
    setupFailed: number;
    classifications: Record<string, number>;
  }): void {
    this.header("MATRIX SUMMARY");
    this.info(`Total scenarios: ${totals.total}`);
    this.info(`Executed: ${totals.executed}`);
    this.info(`Manual required: ${totals.manualRequired}`);
    if (totals.setupFailed > 0) {
      this.warn(`Setup failed: ${totals.setupFailed}`);
    } else {
      this.info(`Setup failed: 0`);
    }
    this.info("Classifications:");
    for (const [classification, count] of Object.entries(totals.classifications)) {
      this.info(`  ${classification}: ${count}`);
    }
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }
}

export function createVerboseLogger(runId: string, verbose = true): VerboseLogger {
  return new VerboseLogger({ runId, verbose, logToFile: true, logToJson: true });
}

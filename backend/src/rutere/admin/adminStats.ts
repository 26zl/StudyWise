/**
 * Admin plattformstatistikk.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkt:
 *   GET /statistikk – Aggregerte nøkkeltall for plattformen
 */
import { Router } from "express";
import {
  AdminLangsmithDailyMetricsResponseSchema,
  AdminLangsmithOverviewResponseSchema,
  AdminLangsmithRunDetailSchema,
  AdminLangsmithRunsResponseSchema,
  AdminLangsmithStatsResponseSchema,
  AdminStatsResponseSchema,
} from "common/admin";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { SharedChat } from "../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
import { AuditLog } from "../../database/models/AuditLog.js";
import { DeletedUserTombstone } from "../../database/models/DeletedUserTombstone.js";
import { WebPushSubscriptionModel } from "../../database/models/WebPushSubscription.js";
import { backfillMissingFullText } from "../../services/embedding.service.js";
import { apiError, requireUserId } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { langsmithClient } from "../../lib/langsmith.js";
import type { Run } from "langsmith/schemas";

const router = Router();

const ACTIVE_FILTER = { deletedAt: { $exists: false } };
const DAY_MS = 24 * 60 * 60 * 1000;
const LANGSMITH_CACHE_TTL = 300; // 5 minutter — admin-stats trenger ikke sanntid
const LANGSMITH_STATS_CACHE_KEY = "admin:langsmith:stats:v2";
const LANGSMITH_RUNS_CACHE_KEY = "admin:langsmith:runs:v2";
const LANGSMITH_PROJECT = process.env.LANGCHAIN_PROJECT || "studywise";

interface LangsmithRunSnapshot {
  id?: string;
  start_time?: unknown;
  end_time?: unknown;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  error?: unknown;
  extra?: unknown;
}

function avrundEnDesimal(verdi: number): number {
  return Math.round(verdi * 10) / 10;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lagTomPeriode() {
  return {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function lagTomLangsmithStats() {
  return AdminLangsmithStatsResponseSchema.parse({
    period: { days7: lagTomPeriode(), days30: lagTomPeriode() },
    dailyTokens: [],
    avgLatencyMs: 0,
    errorRate: 0,
    byIntent: {},
  });
}

function trimText(value: unknown, max = 6000): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function hentMetadata(run: LangsmithRunSnapshot): Record<string, unknown> {
  const extra = (run.extra ?? {}) as Record<string, unknown>;
  const metadata = extra.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function hentIntent(run: LangsmithRunSnapshot): string {
  const extra = (run.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.intent === "string" && extra.intent.trim().length > 0) return extra.intent.trim();
  if (typeof extra.mode === "string" && extra.mode.trim().length > 0) return extra.mode.trim();

  const metadata = hentMetadata(run);
  if (typeof metadata.intent === "string" && metadata.intent.trim().length > 0) {
    return metadata.intent.trim();
  }
  if (typeof metadata.mode === "string" && metadata.mode.trim().length > 0) {
    return metadata.mode.trim();
  }

  return "ukjent";
}

function hentModel(run: LangsmithRunSnapshot): string {
  const inputs = (run.inputs ?? {}) as Record<string, unknown>;
  if (typeof inputs.model === "string" && inputs.model.trim().length > 0) return inputs.model.trim();

  const extra = (run.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.model === "string" && extra.model.trim().length > 0) return extra.model.trim();
  return "ukjent";
}

function hentBruker(run: LangsmithRunSnapshot): string {
  const extra = (run.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.userId === "string" && extra.userId.trim().length > 0) return extra.userId.trim();

  const metadata = hentMetadata(run);
  if (typeof metadata.userId === "string" && metadata.userId.trim().length > 0) {
    return metadata.userId.trim();
  }
  return "ukjent";
}

function hentCourse(run: LangsmithRunSnapshot): string {
  const extra = (run.extra ?? {}) as Record<string, unknown>;
  const candidate = extra.courseId;
  if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);

  const metadata = hentMetadata(run);
  const metaCourseId = metadata.courseId;
  if (typeof metaCourseId === "string" && metaCourseId.trim().length > 0) return metaCourseId.trim();
  if (typeof metaCourseId === "number" && Number.isFinite(metaCourseId)) return String(metaCourseId);
  return "ukjent";
}

function hentPromptPreview(run: LangsmithRunSnapshot): string {
  const inputs = (run.inputs ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(inputs.messages) ? inputs.messages : [];
  const userMessages = messages
    .filter((message) => {
      if (!message || typeof message !== "object") return false;
      const role = (message as Record<string, unknown>).role;
      return role === "user";
    })
    .map((message) => {
      if (!message || typeof message !== "object") return "";
      const content = (message as Record<string, unknown>).content;
      return trimText(content, 300);
    })
    .filter(Boolean);

  if (userMessages.length > 0) {
    return trimText(userMessages.join("\n\n"), 1200);
  }

  return trimText(inputs.input, 1200);
}

function hentSystemPromptPreview(run: LangsmithRunSnapshot): string {
  const inputs = (run.inputs ?? {}) as Record<string, unknown>;
  return trimText(inputs.systemPrompt, 1200);
}

function hentOutputPreview(run: LangsmithRunSnapshot): string {
  const outputs = (run.outputs ?? {}) as Record<string, unknown>;
  if (typeof outputs.response === "string") return trimText(outputs.response, 1200);
  return trimText(outputs, 1200);
}

function hentRagSources(run: LangsmithRunSnapshot): Array<{ fileName: string; score?: number }> {
  const metadata = hentMetadata(run);
  const rawSources = metadata.ragSources;
  if (!Array.isArray(rawSources)) return [];

  const sources: Array<{ fileName: string; score?: number }> = [];
  for (const source of rawSources) {
    if (!source || typeof source !== "object") continue;
    const entry = source as Record<string, unknown>;
    const fileNameCandidate = entry.fileName ?? entry.filename ?? entry.name;
    const fileName =
      typeof fileNameCandidate === "string" && fileNameCandidate.trim().length > 0
        ? fileNameCandidate.trim()
        : null;
    if (!fileName) continue;
    const score = typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : undefined;
    sources.push(score === undefined ? { fileName } : { fileName, score });
  }

  return sources;
}

function hentTokens(run: LangsmithRunSnapshot): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const extra = (run.extra ?? {}) as Record<string, unknown>;
  const extraTokenUsage = extra.token_usage as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;
  const metadata = hentMetadata(run);
  const metadataTokenUsage = metadata.token_usage as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;

  const inputTokens =
    run.prompt_tokens ??
    extraTokenUsage?.input_tokens ??
    metadataTokenUsage?.input_tokens ??
    0;
  const outputTokens =
    run.completion_tokens ??
    extraTokenUsage?.output_tokens ??
    metadataTokenUsage?.output_tokens ??
    0;
  const totalTokens =
    run.total_tokens ??
    extraTokenUsage?.total_tokens ??
    metadataTokenUsage?.total_tokens ??
    inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Henter LangSmith-runs med Redis-cache.
 * Alle endepunkter deler samme cachede runs-liste for å unngå gjentatte API-kall.
 */
async function hentLangsmithRunsCached(days: number): Promise<LangsmithRunSnapshot[]> {
  if (!langsmithClient) {
    logger.warn("LangSmith-klient mangler, kan ikke hente observability-data");
    return [];
  }

  const cacheKey = `${LANGSMITH_RUNS_CACHE_KEY}:${days}d`;
  const cached = await getCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as LangsmithRunSnapshot[];
    } catch {
      // Korrupt cache — hent på nytt
    }
  }

  const client = langsmithClient;
  const startTime = new Date(Date.now() - days * DAY_MS);

  const runs: LangsmithRunSnapshot[] = [];
  try {
    for await (const run of client.listRuns({
      projectName: LANGSMITH_PROJECT,
      startTime,
      limit: 100,
      order: "desc",
    })) {
      runs.push(run as LangsmithRunSnapshot);
    }
    logger.info(
      { antall: runs.length, dager: days },
      "LangSmith-runs hentet",
    );
  } catch (error) {
    logger.warn(
      { err: error, project: LANGSMITH_PROJECT },
      "LangSmith listRuns feilet — returnerer tom liste",
    );
    return [];
  }

  // Cacher kun ikke-tomme resultater — tomme kan skyldes midlertidige feil.
  // Strip inputs/outputs før caching — brukerprompter og AI-svar skal ikke i Redis.
  if (runs.length > 0) {
    const strippedRuns = runs.map(({ inputs: _i, outputs: _o, ...rest }) => rest);
    await setCache(cacheKey, JSON.stringify(strippedRuns), LANGSMITH_CACHE_TTL);
  }
  return runs;
}

async function hentLangsmithStatsMedCache() {
  const cached = await getCache(LANGSMITH_STATS_CACHE_KEY);
  if (cached) {
    return AdminLangsmithStatsResponseSchema.parse(JSON.parse(cached));
  }

  if (!langsmithClient) {
    const tomtSvar = lagTomLangsmithStats();
    await setCache(
      LANGSMITH_STATS_CACHE_KEY,
      JSON.stringify(tomtSvar),
      LANGSMITH_CACHE_TTL,
    );
    return tomtSvar;
  }

  const nå = Date.now();
  const grense7 = nå - 7 * DAY_MS;
  const grense30 = nå - 30 * DAY_MS;
  const dailyMap = new Map<string, { inputTokens: number; outputTokens: number }>();
  for (let i = 29; i >= 0; i -= 1) {
    const dayDate = new Date(nå - i * DAY_MS);
    dailyMap.set(isoDateKey(dayDate), { inputTokens: 0, outputTokens: 0 });
  }

  const byIntent: Record<string, { runs: number; tokens: number }> = Object.create(null) as Record<string, { runs: number; tokens: number }>;
  const period7 = lagTomPeriode();
  const period30 = lagTomPeriode();
  let latencySum = 0;
  let latencyCount = 0;
  let errorCount = 0;

  const runs = await hentLangsmithRunsCached(30);
  for (const run of runs) {
    const startTs = asTimestamp(run.start_time);
    if (!startTs || startTs < grense30) continue;

    const { inputTokens, outputTokens, totalTokens } = hentTokens(run);

    period30.runs += 1;
    period30.inputTokens += inputTokens;
    period30.outputTokens += outputTokens;
    period30.totalTokens += totalTokens;

    if (startTs >= grense7) {
      period7.runs += 1;
      period7.inputTokens += inputTokens;
      period7.outputTokens += outputTokens;
      period7.totalTokens += totalTokens;
    }

    const dateKey = isoDateKey(new Date(startTs));
    const currentDaily = dailyMap.get(dateKey);
    if (currentDaily) {
      currentDaily.inputTokens += inputTokens;
      currentDaily.outputTokens += outputTokens;
    }

    const endTs = asTimestamp(run.end_time);
    if (endTs && endTs >= startTs) {
      latencySum += endTs - startTs;
      latencyCount += 1;
    }

    if (run.error) {
      errorCount += 1;
    }

    const intentValue = hentIntent(run);
    if (!byIntent[intentValue]) {
      byIntent[intentValue] = { runs: 0, tokens: 0 };
    }
    byIntent[intentValue].runs += 1;
    byIntent[intentValue].tokens += totalTokens;
  }

  const response = AdminLangsmithStatsResponseSchema.parse({
    period: { days7: period7, days30: period30 },
    dailyTokens: Array.from(dailyMap.entries()).map(([date, values]) => ({
      date,
      inputTokens: values.inputTokens,
      outputTokens: values.outputTokens,
    })),
    avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
    errorRate: period30.runs > 0 ? errorCount / period30.runs : 0,
    byIntent,
  });

  // Cacher kun resultater med faktiske runs — tomme kan skyldes midlertidige feil
  if (period30.runs > 0) {
    await setCache(
      LANGSMITH_STATS_CACHE_KEY,
      JSON.stringify(response),
      LANGSMITH_CACHE_TTL,
    );
  }
  return response;
}

router.get("/langsmith/stats", async (req, res) => {
  try {
    const response = await hentLangsmithStatsMedCache();
    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.stats" },
      req,
    });
    return res.json(response);
  } catch (err) {
    logger.error({ err }, "Admin LangSmith-statistikk feilet");
    return apiError.serverError(res);
  }
});

router.get("/langsmith/overview", async (req, res) => {
  try {
    const stats = await hentLangsmithStatsMedCache();
    const totalTokens24h =
      stats.dailyTokens.at(-1) != null
        ? stats.dailyTokens.at(-1)!.inputTokens + stats.dailyTokens.at(-1)!.outputTokens
        : 0;
    const totalTokens7d = stats.period.days7.totalTokens;
    const runs7d = await hentLangsmithRunsCached(7);
    const last24hThreshold = Date.now() - DAY_MS;
    const totalRuns24h = runs7d.filter((run) => {
      const startTs = asTimestamp(run.start_time);
      return startTs != null && startTs >= last24hThreshold;
    }).length;

    const overview = AdminLangsmithOverviewResponseSchema.parse({
      totalRuns24h,
      totalRuns7d: stats.period.days7.runs,
      totalTokens24h,
      totalTokens7d,
      avgLatencyMs: stats.avgLatencyMs,
      errorRatePercent: Math.round(stats.errorRate * 1000) / 10,
    });

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.overview" },
      req,
    });
    return res.json(overview);
  } catch (err) {
    logger.error({ err }, "Admin LangSmith overview feilet");
    if (!res.headersSent) {
      return apiError.serverError(res);
    }
    return;
  }
});

router.get("/langsmith/daily-metrics", async (req, res) => {
  try {
    const daysRaw = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : 30;
    const days = Number.isInteger(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 30;
    const now = Date.now();
    const map = new Map<string, { inputTokens: number; outputTokens: number; latencySum: number; latencyCount: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      map.set(isoDateKey(new Date(now - i * DAY_MS)), {
        inputTokens: 0,
        outputTokens: 0,
        latencySum: 0,
        latencyCount: 0,
      });
    }

    const runsMedFallback = await hentLangsmithRunsCached(days);
    for (const run of runsMedFallback) {
      const startTs = asTimestamp(run.start_time);
      if (!startTs) continue;

      const { inputTokens, outputTokens } = hentTokens(run);

      const dateKey = isoDateKey(new Date(startTs));
      const current = map.get(dateKey);
      if (!current) continue;

      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;

      const endTs = asTimestamp(run.end_time);
      if (endTs && endTs >= startTs) {
        current.latencySum += endTs - startTs;
        current.latencyCount += 1;
      }
    }

    const response = AdminLangsmithDailyMetricsResponseSchema.parse({
      days,
      data: Array.from(map.entries()).map(([date, values]) => ({
        date,
        inputTokens: values.inputTokens,
        outputTokens: values.outputTokens,
        avgLatencyMs: values.latencyCount > 0 ? Math.round(values.latencySum / values.latencyCount) : 0,
      })),
    });

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.dailyMetrics", days },
      req,
    });
    return res.json(response);
  } catch (err) {
    logger.error({ err }, "Admin LangSmith daily metrics feilet");
    return apiError.serverError(res);
  }
});

router.get("/langsmith/runs", async (req, res) => {
  try {
    if (!langsmithClient) {
      return res.json(
        AdminLangsmithRunsResponseSchema.parse({ runs: [], total: 0, page: 1, pageSize: 20 }),
      );
    }

    const pageRaw = typeof req.query.page === "string" ? Number.parseInt(req.query.page, 10) : 1;
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "all";
    const intentFilter = typeof req.query.intent === "string" ? req.query.intent.trim().toLowerCase() : "";
    const pageSize = 20;
    const skip = (page - 1) * pageSize;
    const allRuns = await hentLangsmithRunsCached(30);

    const filtered = allRuns.filter((run) => {
      const intent = hentIntent(run).toLowerCase();
      const matchesIntent = intentFilter.length === 0 || intent.includes(intentFilter);
      if (!matchesIntent) return false;
      if (status === "success") return !run.error;
      if (status === "error") return Boolean(run.error);
      return true;
    });

    const paged = filtered.slice(skip, skip + pageSize).map((run) => {
      const startTs = asTimestamp(run.start_time) ?? Date.now();
      const endTs = asTimestamp(run.end_time);
      const latencyMs = endTs && endTs >= startTs ? endTs - startTs : 0;
      const { inputTokens, outputTokens, totalTokens } = hentTokens(run);
      return {
        id: run.id ?? `${startTs}`,
        timestamp: new Date(startTs).toISOString(),
        model: hentModel(run),
        intent: hentIntent(run),
        user: hentBruker(run),
        course: hentCourse(run),
        inputTokens,
        outputTokens,
        totalTokens,
        latencyMs,
        status: run.error ? "error" : "success",
      };
    });

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.runs", page, pageSize },
      req,
    });
    return res.json(
      AdminLangsmithRunsResponseSchema.parse({
        runs: paged,
        total: filtered.length,
        page,
        pageSize,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin LangSmith runs feilet");
    return apiError.serverError(res);
  }
});

router.get("/langsmith/runs/:runId", async (req, res) => {
  try {
    if (!langsmithClient) {
      return apiError.notFound(res, "LangSmith-run");
    }

    const runId = req.params.runId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
      return apiError.badRequest(res, "Ugyldig run-ID format");
    }
    const run = (await langsmithClient.readRun(runId)) as Run & LangsmithRunSnapshot;

    // Verifiser at run tilhører riktig prosjekt — hindrer eksponering av data fra andre prosjekter
    const runSession = (run as unknown as { session_name?: string }).session_name
      ?? (run as unknown as { project_name?: string }).project_name;
    if (runSession && runSession !== LANGSMITH_PROJECT) {
      return apiError.notFound(res, "LangSmith-run");
    }

    const startTs = asTimestamp(run.start_time) ?? Date.now();
    const endTs = asTimestamp(run.end_time);
    const latencyMs = endTs && endTs >= startTs ? endTs - startTs : 0;
    const { inputTokens, outputTokens, totalTokens } = hentTokens(run);

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.runDetail", runId },
      req,
    });
    return res.json(
      AdminLangsmithRunDetailSchema.parse({
        id: run.id,
        timestamp: new Date(startTs).toISOString(),
        model: hentModel(run),
        intent: hentIntent(run),
        user: hentBruker(run),
        course: hentCourse(run),
        inputTokens,
        outputTokens,
        totalTokens,
        latencyMs,
        status: run.error ? "error" : "success",
        promptPreview: hentPromptPreview(run),
        systemPromptPreview: hentSystemPromptPreview(run),
        ragSources: hentRagSources(run),
        outputPreview: hentOutputPreview(run),
        errorMessage: run.error ? trimText(run.error, 1200) : undefined,
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin LangSmith run detail feilet");
    return apiError.serverError(res);
  }
});

router.post("/langsmith/clear-cache", async (req, res) => {
  try {
    const { deleteCacheKeys, invalidateCacheByPattern } = await import("../../cache/redis.js");
    await Promise.all([
      deleteCacheKeys([LANGSMITH_STATS_CACHE_KEY, "admin:langsmith:stats:v1"]),
      invalidateCacheByPattern("admin:langsmith:runs:*"),
      invalidateCacheByPattern("admin:langsmith:daily:*"),
    ]);

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "langsmith.clearCache" },
      req,
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Admin LangSmith cache-clear feilet");
    return apiError.serverError(res);
  }
});

router.get("/statistikk", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const [aktiveBrukere, antallSlettede] = await Promise.all([
      User.find(ACTIVE_FILTER, { _id: 1, role: 1, canvasBaseUrl: 1, authProviders: 1 }).lean(),
      DeletedUserTombstone.countDocuments(),
    ]);

    const aktiveBrukerObjectIds = aktiveBrukere.map((bruker) => bruker._id);
    const aktiveBrukerIds = aktiveBrukerObjectIds.map((id) => id.toString());
    // alleBrukerIds inkluderer kun aktive (hard-delete fjerner slettede fra User-samlingen)
    const alleBrukerObjectIds = aktiveBrukerObjectIds;
    const alleBrukerIds = aktiveBrukerIds;
    const totalBrukere = aktiveBrukere.length;
    const antallAdmin = aktiveBrukere.filter((bruker) => bruker.role === "admin").length;
    const antallMedCanvas = aktiveBrukere.filter((bruker) => Boolean(bruker.canvasBaseUrl)).length;
    const antallUtenCanvas = totalBrukere - antallMedCanvas;
    const antallGoogle = aktiveBrukere.filter((bruker) => bruker.authProviders?.includes("google")).length;
    const antallMicrosoft = aktiveBrukere.filter((bruker) => bruker.authProviders?.includes("microsoft")).length;
    const antallEmail = aktiveBrukere.filter((bruker) => bruker.authProviders?.includes("email")).length;
    const antallUkjentProvider = Math.max(
      totalBrukere - antallGoogle - antallMicrosoft - antallEmail,
      0,
    );
    const canvasBrukerIds = aktiveBrukere
      .filter((bruker) => Boolean(bruker.canvasBaseUrl))
      .map((bruker) => bruker._id.toString());
    const now = new Date();
    const siste24TimerSiden = new Date(now.getTime() - DAY_MS);
    const siste7DagerSiden = new Date(now.getTime() - 7 * DAY_MS);

    const [
      totalSamtaler,
      bokmerkedeSamtaler,
      aktiveDelingslenker,
      inaktiveDelingslenker,
      utlopteDelingslenker,
      delingslenkerMedVisninger,
      delingsvisningerAgg,
      totalOppgaveoppdelinger,
      deloppgaverAgg,
      arbeidsplanAgg,
      totalEmbeddings,
      dokumentfilerAgg,
      dokumentemnerAgg,
      brukereMedInnholdAgg,
      tokenAgg,
      kursstrukturer,
      canvasStrukturAgg,
      syncAgg,
      auditTotalt,
      auditFeilTotalt,
      audit24t,
      auditFeil24t,
      auditKategori24tAgg,
      orphanedSamtaler,
      orphanedOppgaveoppdelinger,
      orphanedDokumentfragmenter,
      orphanedArbeidsplaner,
      orphanedCanvasStrukturer,
      orphanedCanvasBrukere,
      delingerUtenEier,
      pushAbonnementer,
      pushBrukereAgg,
      brukereMedNotion,
    ] = await Promise.all([
      ChatHistory.countDocuments({ user: { $in: aktiveBrukerObjectIds } }),
      ChatHistory.countDocuments({ user: { $in: aktiveBrukerObjectIds }, pinned: true }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, isActive: true }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, isActive: false }),
      SharedChat.countDocuments({
        ownerId: { $in: aktiveBrukerObjectIds },
        expiresAt: { $ne: null, $lt: now },
      }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, viewCount: { $gt: 0 } }),
      SharedChat.aggregate<{ total: number }>([
        { $match: { ownerId: { $in: aktiveBrukerObjectIds } } },
        { $group: { _id: null, total: { $sum: "$viewCount" } } },
      ]),
      TaskBreakdown.countDocuments({ userId: { $in: aktiveBrukerObjectIds } }),
      TaskBreakdown.aggregate<{
        deloppgaverTotalt: number;
        fullforteDeloppgaver: number;
        godkjenteDeloppgaver: number;
      }>([
        { $match: { userId: { $in: aktiveBrukerObjectIds } } },
        {
          $project: {
            antall: { $size: { $ifNull: ["$subtasks", []] } },
            fullforte: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$subtasks", []] },
                  as: "subtask",
                  cond: { $eq: ["$$subtask.completed", true] },
                },
              },
            },
            godkjente: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$subtasks", []] },
                  as: "subtask",
                  cond: { $eq: ["$$subtask.approved", true] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            deloppgaverTotalt: { $sum: "$antall" },
            fullforteDeloppgaver: { $sum: "$fullforte" },
            godkjenteDeloppgaver: { $sum: "$godkjente" },
          },
        },
      ]),
      Arbeidsplan.aggregate<{
        planer: number;
        blokkerTotalt: number;
        fullforteBlokker: number;
        brukereMedPlan: string[];
      }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        {
          $project: {
            userId: 1,
            antallBlokker: { $size: { $ifNull: ["$blocks", []] } },
            fullforteBlokker: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$blocks", []] },
                  as: "block",
                  cond: { $eq: ["$$block.completed", true] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            planer: { $sum: 1 },
            blokkerTotalt: { $sum: "$antallBlokker" },
            fullforteBlokker: { $sum: "$fullforteBlokker" },
            brukereMedPlan: { $addToSet: "$userId" },
          },
        },
      ]),
      ContentEmbedding.countDocuments({ userId: { $in: aktiveBrukerIds } }),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" } } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: { userId: "$userId", courseId: "$courseId" } } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: "$userId" } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: null, total: { $sum: "$tokenCount" } } },
      ]),
      CanvasStructureModel.countDocuments({ userId: { $in: aktiveBrukerIds } }),
      CanvasStructureModel.aggregate<{
        canvasOppgaver: number;
        canvasKunngjoringer: number;
        canvasModuler: number;
        canvasModulElementer: number;
      }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        {
          $project: {
            oppgaverCount: { $size: { $ifNull: ["$oppgaver", []] } },
            kunngjoringerCount: { $size: { $ifNull: ["$kunngjøringer", []] } },
            modulerCount: { $size: { $ifNull: ["$moduler", []] } },
            modulElementerCount: {
              $sum: {
                $map: {
                  input: { $ifNull: ["$moduler", []] },
                  as: "modul",
                  in: { $size: { $ifNull: ["$$modul.items", []] } },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            canvasOppgaver: { $sum: "$oppgaverCount" },
            canvasKunngjoringer: { $sum: "$kunngjoringerCount" },
            canvasModuler: { $sum: "$modulerCount" },
            canvasModulElementer: { $sum: "$modulElementerCount" },
          },
        },
      ]),
      CanvasStructureModel.aggregate<{ _id: string; sistSyncedAt: Date }>([
        { $match: { userId: { $in: canvasBrukerIds } } },
        { $group: { _id: "$userId", sistSyncedAt: { $max: "$syncedAt" } } },
      ]),
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ outcome: "failure" }),
      AuditLog.countDocuments({ createdAt: { $gte: siste24TimerSiden } }),
      AuditLog.countDocuments({ outcome: "failure", createdAt: { $gte: siste24TimerSiden } }),
      AuditLog.aggregate<{ _id: string; total: number }>([
        { $match: { createdAt: { $gte: siste24TimerSiden } } },
        { $group: { _id: "$category", total: { $sum: 1 } } },
      ]),
      ChatHistory.countDocuments({ user: { $nin: alleBrukerObjectIds } }),
      TaskBreakdown.countDocuments({ userId: { $nin: alleBrukerObjectIds } }),
      ContentEmbedding.countDocuments({ userId: { $nin: alleBrukerIds } }),
      Arbeidsplan.countDocuments({ userId: { $nin: alleBrukerIds } }),
      CanvasStructureModel.countDocuments({ userId: { $nin: alleBrukerIds } }),
      CanvasUser.countDocuments({ localUser: { $nin: alleBrukerObjectIds } }),
      SharedChat.countDocuments({ ownerId: { $nin: alleBrukerObjectIds } }),
      WebPushSubscriptionModel.countDocuments({ userId: { $in: aktiveBrukerObjectIds } }),
      WebPushSubscriptionModel.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerObjectIds } } },
        { $group: { _id: "$userId" } },
        { $count: "total" },
      ]),
      User.countDocuments({ _id: { $in: aktiveBrukerObjectIds }, notionApiKey: { $exists: true, $ne: null } }),
    ]);

    const totalDeloppgaver = deloppgaverAgg[0]?.deloppgaverTotalt ?? 0;
    const fullforteDeloppgaver = deloppgaverAgg[0]?.fullforteDeloppgaver ?? 0;
    const godkjenteDeloppgaver = deloppgaverAgg[0]?.godkjenteDeloppgaver ?? 0;
    const arbeidsplanerTotalt = arbeidsplanAgg[0]?.planer ?? 0;
    const blokkerTotalt = arbeidsplanAgg[0]?.blokkerTotalt ?? 0;
    const fullforteBlokker = arbeidsplanAgg[0]?.fullforteBlokker ?? 0;
    const brukereMedPlan = arbeidsplanAgg[0]?.brukereMedPlan?.length ?? 0;
    const totalDelingsvisninger = delingsvisningerAgg[0]?.total ?? 0;
    const totalDokumentfiler = dokumentfilerAgg[0]?.total ?? 0;
    const totalDokumentemner = dokumentemnerAgg[0]?.total ?? 0;
    const antallBrukereMedInnhold = brukereMedInnholdAgg[0]?.total ?? 0;
    const totalTokens = tokenAgg[0]?.total ?? 0;
    const canvasOppgaver = canvasStrukturAgg[0]?.canvasOppgaver ?? 0;
    const canvasKunngjoringer = canvasStrukturAgg[0]?.canvasKunngjoringer ?? 0;
    const canvasModuler = canvasStrukturAgg[0]?.canvasModuler ?? 0;
    const canvasModulElementer = canvasStrukturAgg[0]?.canvasModulElementer ?? 0;
    const brukereMedSyncData = syncAgg.length;
    const brukereMedFerskSync24t = syncAgg.filter((entry) => new Date(entry.sistSyncedAt) >= siste24TimerSiden).length;
    const brukereMedGammelSync7d = syncAgg.filter((entry) => new Date(entry.sistSyncedAt) < siste7DagerSiden).length;
    const canvasBrukereUtenSyncData = Math.max(canvasBrukerIds.length - brukereMedSyncData, 0);
    const auditKategori24t = Object.fromEntries(auditKategori24tAgg.map((entry) => [entry._id, entry.total]));
    const antallPushBrukere = pushBrukereAgg[0]?.total ?? 0;
    const snittEnheterPerBruker = antallPushBrukere > 0 ? avrundEnDesimal(pushAbonnementer / antallPushBrukere) : 0;
    const snittSamtalerPerBruker = totalBrukere > 0 ? avrundEnDesimal(totalSamtaler / totalBrukere) : 0;
    const snittDeloppgaverPerOppdeling =
      totalOppgaveoppdelinger > 0 ? avrundEnDesimal(totalDeloppgaver / totalOppgaveoppdelinger) : 0;
    const snittChunksPerFil =
      totalDokumentfiler > 0 ? avrundEnDesimal(totalEmbeddings / totalDokumentfiler) : 0;
    const arbeidsplanFullforingsgrad =
      blokkerTotalt > 0 ? avrundEnDesimal((fullforteBlokker / blokkerTotalt) * 100) : 0;

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "statistikk.hent" },
      req,
    });

    return res.json(
      AdminStatsResponseSchema.parse({
        brukere: {
          totalt: totalBrukere,
          admin: antallAdmin,
          vanlige: totalBrukere - antallAdmin,
          medCanvas: antallMedCanvas,
          utenCanvas: antallUtenCanvas,
          slettede: antallSlettede,
          google: antallGoogle,
          microsoft: antallMicrosoft,
          email: antallEmail,
          ukjentProvider: antallUkjentProvider,
        },
        samtaler: {
          totalt: totalSamtaler,
          bokmerket: bokmerkedeSamtaler,
          snittPerBruker: snittSamtalerPerBruker,
        },
        deling: {
          aktiveLenker: aktiveDelingslenker,
          inaktiveLenker: inaktiveDelingslenker,
          utlopteLenker: utlopteDelingslenker,
          lenkerMedVisninger: delingslenkerMedVisninger,
          visningerTotalt: totalDelingsvisninger,
        },
        oppgaver: {
          oppgaveoppdelinger: totalOppgaveoppdelinger,
          deloppgaverTotalt: totalDeloppgaver,
          fullforteDeloppgaver,
          godkjenteDeloppgaver,
          snittDeloppgaverPerOppdeling,
        },
        arbeidsplan: {
          planer: arbeidsplanerTotalt,
          blokkerTotalt,
          fullforteBlokker,
          brukereMedPlan,
          fullforingsgrad: arbeidsplanFullforingsgrad,
        },
        innhold: {
          dokumentfragmenter: totalEmbeddings,
          dokumentfiler: totalDokumentfiler,
          dokumentemner: totalDokumentemner,
          brukereMedInnhold: antallBrukereMedInnhold,
          tokensTotalt: totalTokens,
          snittChunksPerFil,
          kursstrukturer,
          canvasOppgaver,
          canvasKunngjoringer,
          canvasModuler,
          canvasModulElementer,
        },
        sync: {
          brukereMedSyncData,
          brukereMedFerskSync24t,
          brukereMedGammelSync7d,
          canvasBrukereUtenSyncData,
        },
        varsler: {
          pushAbonnementer,
          brukereMedPush: antallPushBrukere,
          snittEnheterPerBruker,
        },
        integrasjoner: {
          brukereMedNotion,
        },
        revisjon: {
          hendelserTotalt: auditTotalt,
          feilTotalt: auditFeilTotalt,
          hendelser24t: audit24t,
          feil24t: auditFeil24t,
          admin24t: auditKategori24t.admin ?? 0,
          auth24t: auditKategori24t.auth ?? 0,
          integration24t: auditKategori24t.integration ?? 0,
          ki24t: auditKategori24t.ki ?? 0,
          privacy24t: auditKategori24t.privacy ?? 0,
          profile24t: auditKategori24t.profile ?? 0,
          security24t: auditKategori24t.security ?? 0,
        },
        kvalitet: {
          orphanedSamtaler,
          orphanedOppgaveoppdelinger,
          orphanedDokumentfragmenter,
          orphanedArbeidsplaner,
          orphanedCanvasStrukturer,
          orphanedCanvasBrukere,
          delingerUtenEier,
        },
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin statistikk feilet");
    return apiError.serverError(res);
  }
});

router.post("/maintenance/backfill-fulltext", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const result = await backfillMissingFullText();

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "maintenance.backfillFullText",
        scannedFiles: result.scannedFiles,
        updatedFiles: result.updatedFiles,
      },
      req,
    });

    return res.json({
      suksess: true,
      ...result,
    });
  } catch (err) {
    logger.error({ err }, "Admin fullText-backfill feilet");
    return apiError.serverError(res);
  }
});

export default router;

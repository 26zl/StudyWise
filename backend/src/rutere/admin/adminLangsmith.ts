/**
 * Admin LangSmith-observabilitet.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET  /langsmith/stats          – Aggregerte stats (7d/30d, daglige tokens, latency, errors)
 *   GET  /langsmith/overview       – Oversikt for cards (24h/7d, latency, error rate)
 *   GET  /langsmith/daily-metrics  – Dag-for-dag tokens og latency (parameterisert antall dager)
 *   GET  /langsmith/runs           – Paginert liste over runs (filtrert på status/intent)
 *   GET  /langsmith/runs/:runId    – Detaljert run-info inkl. prompt-preview og RAG-kilder
 *   POST /langsmith/clear-cache    – Tøm Redis-cachen for stats/runs/daily
 */
import { Router } from "express";
import {
  AdminLangsmithDailyMetricsResponseSchema,
  AdminLangsmithOverviewResponseSchema,
  AdminLangsmithRunDetailSchema,
  AdminLangsmithRunsResponseSchema,
  AdminLangsmithStatsResponseSchema,
} from "common/admin";
import { apiError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { langsmithClient } from "../../lib/langsmith.js";
import type { Run } from "langsmith/schemas";

const router = Router();

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
  // Normaliserte felter beregnet fra inputs/outputs før caching,
  // slik at modellnavn + token-tall overlever at vi stripper inputs/outputs
  // (brukerprompter og AI-svar skal ikke i Redis).
  _normalizedModel?: string;
  _normalizedInputTokens?: number;
  _normalizedOutputTokens?: number;
  _normalizedTotalTokens?: number;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // LangSmith SDK returnerer start_time/end_time som Date-objekter i fresh fetch
  // (før serialisering til Redis gjør dem om til ISO-strings).
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
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
  // Normalisert felt (satt ved fetch-tid, overlever caching)
  if (run._normalizedModel && run._normalizedModel.length > 0) return run._normalizedModel;

  const inputs = (run.inputs ?? {}) as Record<string, unknown>;
  if (typeof inputs.model === "string" && inputs.model.trim().length > 0) return inputs.model.trim();

  const extra = (run.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.model === "string" && extra.model.trim().length > 0) return extra.model.trim();

  // LangSmith-standardlokasjoner for LLM-runs
  const invocationParams = extra.invocation_params as Record<string, unknown> | undefined;
  if (invocationParams && typeof invocationParams.model === "string" && invocationParams.model.trim().length > 0) {
    return invocationParams.model.trim();
  }
  if (invocationParams && typeof invocationParams.model_name === "string" && invocationParams.model_name.trim().length > 0) {
    return invocationParams.model_name.trim();
  }

  const metadata = hentMetadata(run);
  if (typeof metadata.ls_model_name === "string" && metadata.ls_model_name.trim().length > 0) {
    return metadata.ls_model_name.trim();
  }
  if (typeof metadata.model === "string" && metadata.model.trim().length > 0) {
    return metadata.model.trim();
  }

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
  // Normaliserte felter (satt ved fetch-tid, overlever caching)
  if (
    run._normalizedInputTokens != null ||
    run._normalizedOutputTokens != null ||
    run._normalizedTotalTokens != null
  ) {
    const inputTokens = run._normalizedInputTokens ?? 0;
    const outputTokens = run._normalizedOutputTokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: run._normalizedTotalTokens ?? inputTokens + outputTokens,
    };
  }

  type TokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };

  const extra = (run.extra ?? {}) as Record<string, unknown>;
  const extraTokenUsage = extra.token_usage as TokenUsage | undefined;
  const metadata = hentMetadata(run);
  const metadataTokenUsage = metadata.token_usage as TokenUsage | undefined;

  // LangSmith legger ofte usage i outputs.llm_output.token_usage eller
  // outputs.generations[*].message.usage_metadata (LangChain-chat)
  const outputs = (run.outputs ?? {}) as Record<string, unknown>;
  const llmOutput = outputs.llm_output as Record<string, unknown> | undefined;
  const llmOutputUsage = llmOutput?.token_usage as TokenUsage | undefined;
  const outputsUsage = outputs.usage_metadata as TokenUsage | undefined;

  let generationUsage: TokenUsage | undefined;
  const generations = outputs.generations;
  if (Array.isArray(generations) && generations.length > 0) {
    const firstGen = Array.isArray(generations[0]) ? generations[0][0] : generations[0];
    const message = (firstGen as Record<string, unknown> | undefined)?.message as
      | Record<string, unknown>
      | undefined;
    generationUsage = message?.usage_metadata as TokenUsage | undefined;
  }

  // Hjelper: returnér første kandidat som er et tall > 0. `??` fungerer ikke her
  // fordi LangSmith returnerer top-level prompt_tokens som tallet 0 (ikke null),
  // og `0 ?? fallback` returnerer 0 i stedet for å falle gjennom til extra.token_usage.
  const firstPositive = (...candidates: Array<number | null | undefined>): number => {
    for (const c of candidates) {
      if (typeof c === "number" && c > 0) return c;
    }
    return 0;
  };

  const inputTokens = firstPositive(
    run.prompt_tokens,
    extraTokenUsage?.input_tokens,
    extraTokenUsage?.prompt_tokens,
    metadataTokenUsage?.input_tokens,
    metadataTokenUsage?.prompt_tokens,
    llmOutputUsage?.input_tokens,
    llmOutputUsage?.prompt_tokens,
    outputsUsage?.input_tokens,
    generationUsage?.input_tokens,
  );
  const outputTokens = firstPositive(
    run.completion_tokens,
    extraTokenUsage?.output_tokens,
    extraTokenUsage?.completion_tokens,
    metadataTokenUsage?.output_tokens,
    metadataTokenUsage?.completion_tokens,
    llmOutputUsage?.output_tokens,
    llmOutputUsage?.completion_tokens,
    outputsUsage?.output_tokens,
    generationUsage?.output_tokens,
  );
  const totalTokens = firstPositive(
    run.total_tokens,
    extraTokenUsage?.total_tokens,
    metadataTokenUsage?.total_tokens,
    llmOutputUsage?.total_tokens,
    outputsUsage?.total_tokens,
    generationUsage?.total_tokens,
  ) || inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Henter LangSmith-runs med Redis-cache.
 * Alle endepunkter deler samme cachede runs-liste for å unngå gjentatte API-kall.
 *
 * In-flight dedup: samtidige kall med samme `days` deler én LangSmith-forespørsel
 * (forhindrer at avbrutte admin-sidelastninger trigger flere parallelle LangSmith-kall).
 */
const inFlightLangsmithRuns = new Map<number, Promise<LangsmithRunSnapshot[]>>();

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

  // Slå sammen samtidige fetcher for samme tidsvindu
  const inFlight = inFlightLangsmithRuns.get(days);
  if (inFlight) return inFlight;

  const client = langsmithClient;
  const startTime = new Date(Date.now() - days * DAY_MS);

  const fetchPromise = (async (): Promise<LangsmithRunSnapshot[]> => {
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

    // Normaliser modell + tokens FØR stripping, slik at de overlever caching.
    // (hentModel/hentTokens leser disse feltene først når de er satt.)
    for (const run of runs) {
      run._normalizedModel = hentModel(run);
      const tokens = hentTokens(run);
      run._normalizedInputTokens = tokens.inputTokens;
      run._normalizedOutputTokens = tokens.outputTokens;
      run._normalizedTotalTokens = tokens.totalTokens;
    }


    // Cacher kun ikke-tomme resultater — tomme kan skyldes midlertidige feil.
    // Strip inputs/outputs før caching — brukerprompter og AI-svar skal ikke i Redis.
    if (runs.length > 0) {
      const strippedRuns = runs.map(({ inputs: _i, outputs: _o, ...rest }) => rest);
      await setCache(cacheKey, JSON.stringify(strippedRuns), LANGSMITH_CACHE_TTL);
    }
    return runs;
  })();

  inFlightLangsmithRuns.set(days, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightLangsmithRuns.delete(days);
  }
}

async function hentLangsmithStatsMedCache() {
  const cached = await getCache(LANGSMITH_STATS_CACHE_KEY);
  if (cached) {
    return AdminLangsmithStatsResponseSchema.parse(JSON.parse(cached));
  }

  if (!langsmithClient) {
    // Ikke cache "klient mangler"-tilstand — den skal forsvinne så snart
    // LANGCHAIN_API_KEY settes, uten å vente på TTL.
    return lagTomLangsmithStats();
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

export default router;

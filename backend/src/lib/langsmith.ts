import { randomUUID } from "crypto";
import { Client } from "langsmith";
import type { ChatMessage } from "../rutere/ki/aiClient.js";
import { logger } from "../utils/logger.js";

const tracingFlagRaw = process.env.LANGCHAIN_TRACING_V2 ?? process.env.LANGSMITH_TRACING;
const tracingFlag = typeof tracingFlagRaw === "string" ? tracingFlagRaw.trim().toLowerCase() : undefined;
const LANGCHAIN_ENDPOINT =
  process.env.LANGCHAIN_ENDPOINT ||
  process.env.LANGSMITH_ENDPOINT ||
  "https://api.smith.langchain.com";
const LANGCHAIN_API_KEY =
  process.env.LANGCHAIN_API_KEY || process.env.LANGSMITH_API_KEY;
const LANGCHAIN_PROJECT =
  process.env.LANGCHAIN_PROJECT || process.env.LANGSMITH_PROJECT || "studywise";

if (!LANGCHAIN_API_KEY) {
  logger.warn(
    "LANGCHAIN_API_KEY mangler. Hopper over LangSmith-tracing uten å stoppe backend.",
  );
}

export const langsmithClient = LANGCHAIN_API_KEY
  ? new Client({
      apiKey: LANGCHAIN_API_KEY,
      apiUrl: LANGCHAIN_ENDPOINT,
    })
  : null;

if (langsmithClient && tracingFlag !== "false") {
  logger.info({ project: LANGCHAIN_PROJECT }, "LangSmith tracing er aktivert");
}

let projectReadyPromise: Promise<void> | null = null;

async function ensureLangsmithProjectReady(): Promise<void> {
  if (!langsmithClient) return;
  if (projectReadyPromise) return projectReadyPromise;

  projectReadyPromise = (async () => {
    try {
      await langsmithClient.readProject({ projectName: LANGCHAIN_PROJECT });
    } catch {
      await langsmithClient.createProject({
        projectName: LANGCHAIN_PROJECT,
        upsert: true,
      });
      logger.info({ project: LANGCHAIN_PROJECT }, "LangSmith-prosjekt opprettet");
    }
  })();

  return projectReadyPromise;
}

function isLangsmithEnabled(): boolean {
  if (!langsmithClient) return false;
  if (tracingFlag === "false") return false;
  return true;
}

export interface LangsmithTraceMeta {
  userId?: string;
  courseId?: number | string;
  intent?: string;
  mode?: string;
}

export interface StartLangsmithRunInput {
  name: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  meta?: LangsmithTraceMeta;
}

export async function startLangsmithRun(
  input: StartLangsmithRunInput,
): Promise<string | null> {
  if (!isLangsmithEnabled() || !langsmithClient) return null;

  const runId = randomUUID();
  try {
    await ensureLangsmithProjectReady();

    const runPayload = {
      id: runId,
      name: input.name,
      run_type: "llm",
      project_name: LANGCHAIN_PROJECT,
      start_time: Date.now(),
      inputs: {
        messages: input.messages,
        model: input.model,
        systemPrompt: input.systemPrompt ?? "",
      },
      extra: {
        userId: input.meta?.userId ?? null,
        courseId: input.meta?.courseId ?? null,
        intent: input.meta?.intent ?? null,
        mode: input.meta?.mode ?? null,
      },
    };

    try {
      await langsmithClient.createRun(runPayload);
    } catch (projectError) {
      logger.warn(
        { err: projectError, project: LANGCHAIN_PROJECT },
        "LangSmith createRun med prosjekt feilet, prøver uten prosjekt",
      );
      await langsmithClient.createRun({ ...runPayload, project_name: undefined });
    }

    return runId;
  } catch (error) {
    logger.warn({ err: error }, "LangSmith createRun feilet");
    return null;
  }
}

export async function finishLangsmithRun(input: {
  runId: string | null;
  response?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: unknown;
}): Promise<void> {
  if (!input.runId || !isLangsmithEnabled() || !langsmithClient) return;

  try {
    const inputTokens = input.usage?.prompt_tokens ?? 0;
    const outputTokens = input.usage?.completion_tokens ?? 0;
    const totalTokens = input.usage?.total_tokens ?? inputTokens + outputTokens;

    await langsmithClient.updateRun(input.runId, {
      end_time: Date.now(),
      outputs: input.response ? { response: input.response } : undefined,
      error: input.error
        ? input.error instanceof Error
          ? input.error.message
          : String(input.error)
        : undefined,
      extra: {
        token_usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
        },
      },
    });

    try {
      const { deleteCacheKeys, invalidateCacheByPattern } = await import("../cache/redis.js");
      await Promise.all([
        deleteCacheKeys(["admin:langsmith:stats:v2"]),
        invalidateCacheByPattern("admin:langsmith:runs:v2:*"),
        invalidateCacheByPattern("admin:langsmith:daily:v1:*"),
      ]);
    } catch (cacheError) {
      logger.warn({ err: cacheError }, "LangSmith cache invalidation feilet");
    }
  } catch (error) {
    logger.warn({ err: error }, "LangSmith updateRun feilet");
  }
}

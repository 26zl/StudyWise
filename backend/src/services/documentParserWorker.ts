import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DocumentParseResult } from "common/document";
import type { ParseDocumentOptions } from "./document.js";

interface ParseWorkerSuccessMessage {
  ok: true;
  result: DocumentParseResult;
}

interface ParseWorkerErrorMessage {
  ok: false;
  error: string;
}

type ParseWorkerMessage = ParseWorkerSuccessMessage | ParseWorkerErrorMessage;

export const PARSE_TIMEOUT_MS = 60_000;
export const PARSE_TIMEOUT_ERROR = "PARSE_TIMEOUT";
export const PARSE_WORKER_CRASHED_ERROR = "PARSE_WORKER_CRASHED";

export type ParseWorkerRuntimeError =
  | typeof PARSE_TIMEOUT_ERROR
  | typeof PARSE_WORKER_CRASHED_ERROR;

export function getParseWorkerRuntimeError(error: unknown): ParseWorkerRuntimeError | null {
  if (!(error instanceof Error)) return null;
  if (error.message === PARSE_TIMEOUT_ERROR) return PARSE_TIMEOUT_ERROR;
  if (error.message === PARSE_WORKER_CRASHED_ERROR) return PARSE_WORKER_CRASHED_ERROR;
  return null;
}

export function getParseWorkerUserMessage(
  error: unknown,
  context: "document-analyse" | "knowledge-base",
): string | null {
  const parseWorkerError = getParseWorkerRuntimeError(error);
  if (!parseWorkerError) return null;

  if (parseWorkerError === PARSE_TIMEOUT_ERROR) {
    if (context === "knowledge-base") {
      return "Kunne ikke lese filen innen tidsgrensen (60 sekunder). Prøv en mindre fil eller et annet format.";
    }
    return "Dokumentet tok for lang tid å lese. Prøv en mindre fil eller et annet format.";
  }

  if (context === "knowledge-base") {
    return "Dokumentparseren stoppet uventet under behandling. Prøv igjen.";
  }
  return "Dokumentparseren stoppet uventet. Prøv igjen om litt.";
}

function createDocumentParserWorker(): Worker {
  const workerJsUrl = new URL("../workers/documentParser.worker.js", import.meta.url);
  const workerTsUrl = new URL("../workers/documentParser.worker.ts", import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const workerUrl = existsSync(fileURLToPath(workerJsUrl)) ? workerJsUrl : workerTsUrl;

  // Forward only loader-related flags to worker threads.
  // `tsx -e` adds eval flags in process.execArgv that should not be inherited.
  const workerExecArgv: string[] = [];
  for (let i = 0; i < process.execArgv.length; i += 1) {
    const arg = process.execArgv[i];
    if (arg === "--require" || arg === "-r" || arg === "--import") {
      const value = process.execArgv[i + 1];
      if (value) {
        workerExecArgv.push(arg, value);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--require=") || arg.startsWith("--import=")) {
      workerExecArgv.push(arg);
    }
  }

  if (workerExecArgv.length > 0) {
    return new Worker(workerUrl, { execArgv: workerExecArgv });
  }
  return new Worker(workerUrl);
}

function toTransferableArrayBuffer(buffer: Buffer): ArrayBuffer {
  const rawBuffer = buffer.buffer;

  if (
    rawBuffer instanceof ArrayBuffer &&
    buffer.byteOffset === 0 &&
    buffer.byteLength === rawBuffer.byteLength
  ) {
    return rawBuffer;
  }

  if (rawBuffer instanceof ArrayBuffer) {
    return rawBuffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  return Uint8Array.from(buffer).buffer;
}

export async function parseDocumentInWorker(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  options?: ParseDocumentOptions,
): Promise<DocumentParseResult> {
  const worker = createDocumentParserWorker();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  try {
    return await new Promise<DocumentParseResult>((resolve, reject) => {
      const resolveOnce = (result: DocumentParseResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      worker.once("message", (message: ParseWorkerMessage) => {
        if (message.ok) {
          resolveOnce(message.result);
          return;
        }
        rejectOnce(new Error(message.error || "PARSE_WORKER_ERROR"));
      });

      worker.once("error", () => {
        rejectOnce(new Error(PARSE_WORKER_CRASHED_ERROR));
      });

      worker.once("exit", (code) => {
        if (settled) return;
        if (code !== 0) {
          rejectOnce(new Error(PARSE_WORKER_CRASHED_ERROR));
        }
      });

      timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        reject(new Error(PARSE_TIMEOUT_ERROR));
      }, PARSE_TIMEOUT_MS);

      const transferableBuffer = toTransferableArrayBuffer(buffer);
      worker.postMessage(
        {
          buffer: transferableBuffer,
          mimeType,
          originalName,
          options,
        },
        [transferableBuffer],
      );
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    try {
      await worker.terminate();
    } catch {
      // Worker kan allerede være terminert via timeout/exit
    }
  }
}
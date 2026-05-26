/**
 * Worker-tråd-entrypunkt for dokumentparsing.
 * Mottar buffer + mimeType fra hovedtråden og returnerer parse-resultat eller feil.
 */

import { parentPort } from "node:worker_threads";
import { parseDocument, type ParseDocumentOptions } from "../services/document.js";

interface ParseWorkerRequest {
  buffer: ArrayBuffer;
  mimeType: string;
  originalName: string;
  options?: ParseDocumentOptions;
}

if (!parentPort) {
  throw new Error("PARSE_WORKER_NO_PARENT_PORT");
}

parentPort.on("message", async (message: ParseWorkerRequest) => {
  try {
    const result = await parseDocument(
      Buffer.from(message.buffer),
      message.mimeType,
      message.originalName,
      message.options,
    );
    parentPort!.postMessage({ ok: true, result });
  } catch (error) {
    const errorMessage =
      error instanceof Error && error.message ? error.message : "Ukjent feil ved dokumentparsing";
    parentPort!.postMessage({ ok: false, error: errorMessage });
  }
});

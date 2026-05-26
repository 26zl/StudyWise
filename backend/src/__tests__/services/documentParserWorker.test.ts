import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Worker } from "node:worker_threads";

vi.mock("node:worker_threads", () => ({
  Worker: vi.fn(),
}));

import { PARSE_TIMEOUT_MS, parseDocumentInWorker } from "../../services/documentParserWorker.js";

type WorkerEventName = "message" | "error" | "exit";

function lagMockWorker() {
  const listeners = new Map<WorkerEventName, (...args: unknown[]) => void>();

  return {
    once: vi.fn((event: WorkerEventName, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    postMessage: vi.fn(),
    terminate: vi.fn(async () => 0),
    emit(event: WorkerEventName, ...args: unknown[]) {
      const listener = listeners.get(event);
      if (!listener) return;
      listeners.delete(event);
      listener(...args);
    },
  };
}

describe("parseDocumentInWorker", () => {
  const WorkerMock = Worker as unknown as {
    mockReset: () => void;
    mockImplementation: (impl: (...args: unknown[]) => unknown) => void;
  };

  beforeEach(() => {
    WorkerMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolver resultat fra worker og sender transferList", async () => {
    const worker = lagMockWorker();
    WorkerMock.mockImplementation(() => worker as never);

    const expected = {
      success: true,
      text: "Parsed tekst",
      pages: 1,
      fileType: "txt",
      redacted: false,
      truncated: false,
    };

    const promise = parseDocumentInWorker(Buffer.from("Hei verden"), "text/plain", "test.txt");

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const [payload, transferList] = worker.postMessage.mock.calls[0] as [
      { buffer: ArrayBuffer; mimeType: string; originalName: string },
      ArrayBuffer[],
    ];
    expect(payload.mimeType).toBe("text/plain");
    expect(payload.originalName).toBe("test.txt");
    expect(transferList).toHaveLength(1);
    expect(transferList[0]).toBe(payload.buffer);

    worker.emit("message", { ok: true, result: expected });

    await expect(promise).resolves.toEqual(expected);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("kaster PARSE_TIMEOUT etter hard timeout", async () => {
    vi.useFakeTimers();

    const worker = lagMockWorker();
    WorkerMock.mockImplementation(() => worker as never);

    const promise = parseDocumentInWorker(Buffer.from("henger"), "text/plain", "timeout.txt");

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).rejects.toThrow("PARSE_TIMEOUT");
    expect(worker.terminate.mock.calls.length).toBeGreaterThan(0);
  });

  it("kaster PARSE_WORKER_CRASHED ved non-zero exit", async () => {
    const worker = lagMockWorker();
    WorkerMock.mockImplementation(() => worker as never);

    const promise = parseDocumentInWorker(Buffer.from("krasj"), "text/plain", "crash.txt");

    worker.emit("exit", 1);

    await expect(promise).rejects.toThrow("PARSE_WORKER_CRASHED");
    expect(worker.terminate).toHaveBeenCalled();
  });
});

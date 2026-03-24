export interface LinkedAbortController {
  signal: AbortSignal;
  abort: () => void;
  cleanup: () => void;
}

export function createLinkedAbortController(
  ...signals: Array<AbortSignal | undefined>
): LinkedAbortController {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  const cleanup = () => {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.length = 0;
  };

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    cleanup();
  };

  for (const signal of signals) {
    if (!signal) continue;

    if (signal.aborted) {
      abort();
      break;
    }

    const listener = () => abort();
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    abort,
    cleanup,
  };
}

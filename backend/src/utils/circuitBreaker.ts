/**
 * Circuit Breaker
 *
 * Forhindrer kaskadesvikt når eksterne tjenester (Canvas API, Anthropic) er trege/nede.
 *
 * Tilstander:
 *   CLOSED  → Alt fungerer normalt, requests sendes gjennom
 *   OPEN    → For mange feil — requests avvises umiddelbart (fail fast)
 *   HALF_OPEN → Prøveperiode — slipper gjennom én request for å teste om tjenesten er oppe
 *
 * Bruk:
 *   const cb = new CircuitBreaker("canvas", { failureThreshold: 5 });
 *   const result = await cb.execute(() => hentCanvasData(...));
 */

import { logger } from "./logger.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
    /** Antall feil før circuit åpnes (default: 5) */
    failureThreshold?: number;
    /** Hvor lenge circuit forblir åpen før half-open (ms, default: 30s) */
    resetTimeoutMs?: number;
    /** Hvilke feil som teller (default: alle) */
    isFailure?: (error: unknown) => boolean;
}

export class CircuitBreaker {
    private state: CircuitState = "CLOSED";
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly name: string;
    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;
    private readonly isFailure: (error: unknown) => boolean;

    constructor(name: string, options: CircuitBreakerOptions = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
        this.isFailure = options.isFailure ?? (() => true);
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // Sjekk om vi skal gå fra OPEN → HALF_OPEN
        if (this.state === "OPEN") {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.resetTimeoutMs) {
                this.state = "HALF_OPEN";
                logger.info({ circuit: this.name }, "Circuit breaker → HALF_OPEN (prøver igjen)");
            } else {
                throw new CircuitBreakerError(
                    this.name,
                    `${this.name} er midlertidig utilgjengelig. Prøv igjen om ${Math.ceil((this.resetTimeoutMs - elapsed) / 1000)} sekunder.`,
                );
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            if (this.isFailure(error)) {
                this.onFailure();
            }
            throw error;
        }
    }

    private onSuccess() {
        if (this.state === "HALF_OPEN") {
            logger.info({ circuit: this.name }, "Circuit breaker → CLOSED (tjeneste er oppe)");
        }
        this.failureCount = 0;
        this.state = "CLOSED";
    }

    private onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = "OPEN";
            logger.error(
                { circuit: this.name, failureCount: this.failureCount, resetTimeoutMs: this.resetTimeoutMs },
                "Circuit breaker → OPEN (for mange feil)",
            );
        }
    }

    /** Gjeldende tilstand (for health check / debugging) */
    getState(): CircuitState {
        return this.state;
    }
}

/** Feil som kastes når circuit er åpen (fail fast) */
export class CircuitBreakerError extends Error {
    readonly circuit: string;
    constructor(circuit: string, message: string) {
        super(message);
        this.name = "CircuitBreakerError";
        this.circuit = circuit;
    }
}

// --- Forhåndskonfigurerte circuit breakers for eksterne tjenester ---

/** Canvas API — åpner etter 5 feil, reset etter 30s */
export const canvasCircuit = new CircuitBreaker("Canvas API", {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    // Kun server-feil og timeouts teller — 4xx (auth, not found) er forventet
    isFailure: (error) => {
        const status = (error as { httpStatus?: number }).httpStatus
            ?? (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false; // 4xx er ikke circuit-feil
        return true; // 5xx, timeout, network error
    },
});

/** Anthropic API — åpner etter 3 feil, reset etter 60s (AI er tregere å komme tilbake) */
export const anthropicCircuit = new CircuitBreaker("Anthropic API", {
    failureThreshold: 3,
    resetTimeoutMs: 60_000,
    isFailure: (error) => {
        const status = (error as { status?: number }).status;
        // 529 (overloaded), 500, timeout, network — teller
        // 400 (bad request), 401 (auth) — teller ikke
        if (status && status >= 400 && status < 500) return false;
        return true;
    },
});

/** Pinecone API — åpner etter 4 feil, reset etter 45s */
export const pineconeCircuit = new CircuitBreaker("Pinecone API", {
    failureThreshold: 4,
    resetTimeoutMs: 45_000,
    isFailure: (error) => {
        const status = (error as { status?: number }).status
            ?? (error as { httpStatus?: number }).httpStatus;
        // 400 (bad request), 401/403 (auth) — teller ikke
        if (status && status >= 400 && status < 500) return false;
        return true; // 5xx, timeout, network error
    },
});

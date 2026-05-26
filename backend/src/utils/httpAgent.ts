/*
 * Global HTTP-dispatcher for undici.
 *
 * Setter opp en delt connection pool for alle `fetch()`-kall i backend.
 * Gjenbruker TCP/TLS-handshake på tvers av kall til samme host (Canvas, Anthropic,
 * Cohere, Pinecone, Notion m.fl.) — gir lavere latency og færre socket-leaks
 * under høy last (spesielt Canvas-sync som gjør mange sekvensielle kall).
 *
 * MÅ importeres tidlig i `index.ts` (etter Datadog, før ruter mountes) slik at
 * dispatcheren er aktiv før første fetch-kall skjer.
 *
 * Node 20+ bruker undici internt for global fetch, så `setGlobalDispatcher`
 * påvirker alle eksisterende `fetch()`-kall uten endringer i kall-stedene.
 */

import { Agent, setGlobalDispatcher } from "undici";
import { logger } from "./logger.js";

const dispatcher = new Agent({
  // Hold tilkoblinger åpne i 30 s for gjenbruk
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  // Maks antall samtidige tilkoblinger per origin
  connections: 64,
  // Ingen HTTP/1.1 pipelining (kompatibilitet > marginal gevinst)
  pipelining: 1,
  // Headers timeout — beskytter mot trege upstream
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

setGlobalDispatcher(dispatcher);

logger.info(
  { connections: 64, keepAliveTimeout: 30_000 },
  "Undici global dispatcher konfigurert (connection pooling aktiv)",
);

/**
 * Dev-launcher for documentParser worker.
 *
 * Worker-tråder arver ikke tsx sin ESM-loader automatisk i dev (tsx 4 registrerer
 * via register()-API internt, ikke via execArgv), så `.js`-imports i
 * documentParser.worker.ts feilet med ERR_MODULE_NOT_FOUND.
 *
 * Denne .mjs-filen fungerer som en shim: plain Node kan laste den direkte, og
 * den aktiverer tsx-loaderen inne i workeren FØR .ts-filen importeres.
 *
 * Kun brukt i dev (tsx watch). I prod lastes den kompilerte .worker.js direkte.
 */
import { register } from "tsx/esm/api";

register();

await import("./documentParser.worker.ts");

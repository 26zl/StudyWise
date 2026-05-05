/*
 * Cloudflare-only middleware
 *
 * Blokkerer requests som ikke kommer via Cloudflare-edge i produksjon.
 * Mitigerer Heroku-direct WAF bypass: en angriper som finner Heroku-app-navnet
 * (f.eks. studwize-prod.herokuapp.com) kan ellers nå backend uten at
 * Cloudflares WAF, rate-limit, og bot management er i path.
 *
 * Validerer to ting:
 *   1. CF-Connecting-IP-header er satt (men stoles ikke på alene)
 *   2. SISTE hop i X-Forwarded-For (= peer som koblet direkte til Heroku Router)
 *      er innenfor Cloudflares offisielle IPv4/IPv6 ranges.
 *
 * NB: Vi bruker IKKE req.socket.remoteAddress på Heroku — den er alltid
 * Heroku-routerens interne IP, ikke Cloudflare-edge. Heroku Router appender
 * peer-IP (= Cloudflare edge) som siste hop i X-Forwarded-For før den
 * videresender til dyno-en. Heroku-loggene bekrefter dette formatet:
 * klient-IP, Cloudflare-edge-IP. Det er siste hop som må valideres.
 *
 * Aktiveres kun når ENFORCE_CLOUDFLARE_ONLY=true. PUBLIC_HEALTH_PATHS
 * (kun /health og /ready) er unntatt for Heroku liveness/readiness.
 * /health/dependencies er admin-only og skal IKKE bypasse Cloudflare.
 *
 * Cloudflares offisielle IP-ranges: https://www.cloudflare.com/ips/
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { sendError } from "../utils/apiError.js";

// Cloudflares offisielle IP-ranges (oppdatert: cloudflare.com/ips-v4 + ips-v6)
const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

type ParsedCidr = { network: bigint; mask: bigint; bits: number };

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8n) | BigInt(n);
  }
  return result;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Strip zone-id ("%eth0") if present
  const stripped = ip.split("%")[0] ?? ip;
  // Expand "::" to full form
  const sides = stripped.split("::");
  if (sides.length > 2) return null;
  const head = sides[0] ? sides[0].split(":") : [];
  const tail = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

function parseCidr(cidr: string, totalBits: number): ParsedCidr | null {
  const [ip, bitsStr] = cidr.split("/");
  if (!ip || !bitsStr) return null;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > totalBits) return null;
  const network = totalBits === 32 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  if (network === null) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(totalBits - bits);
  return { network: network & mask, mask, bits };
}

const PARSED_IPV4 = CLOUDFLARE_IPV4_RANGES.map((c) => parseCidr(c, 32)).filter(
  (c): c is ParsedCidr => c !== null,
);
const PARSED_IPV6 = CLOUDFLARE_IPV6_RANGES.map((c) => parseCidr(c, 128)).filter(
  (c): c is ParsedCidr => c !== null,
);

function isCloudflareIp(ip: string): boolean {
  // IPv4-mapped IPv6 ("::ffff:1.2.3.4") — strip prefix og test som IPv4
  const cleaned = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (cleaned.includes(".") && !cleaned.includes(":")) {
    const v4 = ipv4ToBigInt(cleaned);
    if (v4 === null) return false;
    return PARSED_IPV4.some((r) => (v4 & r.mask) === r.network);
  }
  if (cleaned.includes(":")) {
    const v6 = ipv6ToBigInt(cleaned);
    if (v6 === null) return false;
    return PARSED_IPV6.some((r) => (v6 & r.mask) === r.network);
  }
  return false;
}

// Kun ren liveness/readiness for Heroku Router er unntatt. /health/dependencies
// er admin-only og MÅ gå via Cloudflare.
const PUBLIC_HEALTH_PATHS = new Set(["/health", "/ready"]);

/**
 * Returnerer peer-IP som koblet direkte til Heroku Router (siste hop i
 * X-Forwarded-For), eller null hvis header mangler eller ikke har noen hops.
 */
function getPeerIp(req: Request): string | null {
  const xff = req.get("x-forwarded-for");
  if (!xff) return null;
  const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length === 0) return null;
  // Siste hop = peer som koblet til Heroku Router. Det er her Cloudflare-edge
  // havner når trafikk kommer via CF.
  return hops[hops.length - 1] ?? null;
}

/**
 * Krever at requesten kommer fra en Cloudflare-edge IP og har CF-Connecting-IP-header.
 * Health-checks fra Heroku Router er unntatt.
 */
export function requireCloudflare(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_HEALTH_PATHS.has(req.path)) return next();

  const cfConnectingIp = req.get("cf-connecting-ip");
  const peerIp = getPeerIp(req);

  if (!cfConnectingIp || !peerIp) {
    logger.warn(
      { path: req.path, hasCfHeader: Boolean(cfConnectingIp), peerIp },
      "Blokkert: mangler CF-Connecting-IP eller X-Forwarded-For peer",
    );
    return sendError(res, "forbidden", { feil: "Forbidden" });
  }

  if (!isCloudflareIp(peerIp)) {
    logger.warn(
      { path: req.path, peerIp, cfConnectingIp },
      "Blokkert: peer-IP er ikke i Cloudflare-range",
    );
    return sendError(res, "forbidden", { feil: "Forbidden" });
  }

  next();
}

// Eksportert for tester
export const _internal = { isCloudflareIp, ipv4ToBigInt, ipv6ToBigInt, parseCidr, getPeerIp };

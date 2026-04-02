import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rewritesLogged = false;
const CLERK_CUSTOM_ORIGINS = [
  "https://clerk.studwize.page",
  "https://accounts.studwize.page",
];

function getApiUrl() {
  const configuredApiUrl = process.env.INTERNAL_API_URL?.trim();
  if (configuredApiUrl) {
    return configuredApiUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:4000";
  }

  throw new Error("INTERNAL_API_URL må være satt i produksjon");
}

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getClerkFrontendApiOrigin() {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    return null;
  }

  const match = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) {
    return null;
  }

  const encodedFrontendApi = match[1];
  if (!encodedFrontendApi) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedFrontendApi, "base64url")
      .toString("utf8")
      .trim()
      .split("$")[0]
      ?.trim();
    if (!decoded) {
      return null;
    }

    return normalizeOrigin(decoded.startsWith("http") ? decoded : `https://${decoded}`);
  } catch {
    return null;
  }
}

function buildCspValue() {
  const clerkFrontendApiOrigin = getClerkFrontendApiOrigin();
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // unsafe-eval kun i dev (Turbopack source maps) — aldri i prod
    ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
    "https://*.clerk.accounts.dev",
    "https://*.clerk.com",
    "https://challenges.cloudflare.com",
    "https://va.vercel-scripts.com",
    // Datadog RUM SDK worker/chunk loading
    "https://www.datadoghq-browser-agent.com",
  ];
  const connectSrc = [
    "'self'",
    "https://vitals.vercel-analytics.com",
    // Datadog RUM: exact intake-host + eventuelle underdomener for replay/logs
    "https://browser-intake-us5-datadoghq.com",
    "https://*.browser-intake-us5-datadoghq.com",
    "https://*.us5.datadoghq.com",
    "https://*.clerk.accounts.dev",
    "https://*.clerk.com",
  ];
  const frameSrc = [
    "'self'",
    "https://challenges.cloudflare.com",
    "https://*.clerk.accounts.dev",
    "https://*.clerk.com",
    "https://maps.google.com",
    "https://www.google.com",
  ];

  for (const origin of CLERK_CUSTOM_ORIGINS) {
    scriptSrc.push(origin);
    connectSrc.push(origin);
    frameSrc.push(origin);
  }

  if (clerkFrontendApiOrigin) {
    scriptSrc.push(clerkFrontendApiOrigin);
    connectSrc.push(clerkFrontendApiOrigin);
    frameSrc.push(clerkFrontendApiOrigin);
  }

  return [
    "default-src 'self'",
    `script-src ${[...new Set(scriptSrc)].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.instructure.com https://instructure-uploads.s3.amazonaws.com https://img.clerk.com https://*.clerk.com https://*.clerk.accounts.dev",
    "font-src 'self' https://*.clerk.com",
    `connect-src ${[...new Set(connectSrc)].join(" ")}`,
    `frame-src ${[...new Set(frameSrc)].join(" ")}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self' https://*.clerk.com https://*.clerk.accounts.dev ${CLERK_CUSTOM_ORIGINS.join(" ")}${clerkFrontendApiOrigin ? ` ${clerkFrontendApiOrigin}` : ""}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Datadog RUM: mapper DD_RUM_* (Vercel runtime) til NEXT_PUBLIC_DD_RUM_* (build-time inline).
  // Uten dette når ikke server-side env-variabler nettleseren fordi Next.js kun inliner NEXT_PUBLIC_* ved bygging.
  env: {
    NEXT_PUBLIC_DD_RUM_APPLICATION_ID:
      process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID || process.env.DD_RUM_APPLICATION_ID || "",
    NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN:
      process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN || process.env.DD_RUM_CLIENT_TOKEN || "",
    NEXT_PUBLIC_DD_SITE:
      process.env.NEXT_PUBLIC_DD_SITE || process.env.DD_RUM_SITE || "",
  },
  transpilePackages: ["common"],
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
  output: "standalone",
  // Øk timeout for proxy-requests (standard er 30s)
  experimental: {
    proxyTimeout: 180_000, // 3 minutter
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // Sikkerhetshoder for alle sider
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildCspValue(),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const apiUrl = getApiUrl();

    if (process.env.NODE_ENV === "development" && !rewritesLogged) {
      rewritesLogged = true;
      // Logges kun i dev — unngå console.log i produksjon
      process.stdout.write(`[next.config] API rewrites peker til: ${apiUrl}\n`);
    }

    return [
      // 1. Alt som starter med /api/ sendes videre til backend.
      // Dvs. frontend "/api/min-ressurs" -> backend "/api/min-ressurs".
      // Du trenger IKKE legge til nye regler her med mindre du lager ruter
      // i backend som IKKE starter med /api/.
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      // 2. Health check endpoint (spesifikt unntak siden den ligger på roten i backend)
      {
        source: "/health",
        destination: `${apiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rewritesLogged = false;

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

  const encodedFrontendApi = match[1]?.split("$")[0];
  if (!encodedFrontendApi) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedFrontendApi, "base64url").toString("utf8").trim();
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
    "'unsafe-eval'",
    "https://*.clerk.accounts.dev",
    "https://challenges.cloudflare.com",
    "https://va.vercel-scripts.com",
  ];
  const connectSrc = [
    "'self'",
    "https://vitals.vercel-analytics.com",
    "https://*.browser-intake-us5-datadoghq.com",
    "https://*.clerk.accounts.dev",
  ];
  const frameSrc = [
    "'self'",
    "https://challenges.cloudflare.com",
    "https://*.clerk.accounts.dev",
  ];

  if (clerkFrontendApiOrigin) {
    scriptSrc.push(clerkFrontendApiOrigin);
    connectSrc.push(clerkFrontendApiOrigin);
    frameSrc.push(clerkFrontendApiOrigin);
  }

  return [
    "default-src 'self'",
    `script-src ${[...new Set(scriptSrc)].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.instructure.com https://instructure-uploads.s3.amazonaws.com https://img.clerk.com",
    "font-src 'self'",
    `connect-src ${[...new Set(connectSrc)].join(" ")}`,
    `frame-src ${[...new Set(frameSrc)].join(" ")}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["common"],
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
  output: "standalone",
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
            value: "same-origin",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const apiUrl = getApiUrl();

    if (process.env.NODE_ENV === "development" && !rewritesLogged) {
      rewritesLogged = true;
      console.log(`[next.config] API rewrites peker til: ${apiUrl}`);
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

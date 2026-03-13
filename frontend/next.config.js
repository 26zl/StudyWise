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
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.instructure.com https://instructure-uploads.s3.amazonaws.com https://img.clerk.com",
              "font-src 'self'",
              "connect-src 'self' https://vitals.vercel-analytics.com https://*.browser-intake-us5-datadoghq.com https://*.clerk.accounts.dev",
              "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
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

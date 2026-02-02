import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Setter internal api url for backend Docker som første prioritet, ellers bruk public URL
    let apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL;

    // I CI-miljø (Docker build) bruker vi en placeholder - den virkelige URL-en
    // settes via miljøvariabler når containeren starter
    if (!apiUrl) {
      if (process.env.CI === "true") {
        console.log("[next.config] CI-miljø oppdaget, bruker placeholder API URL for build");
        apiUrl = "http://backend:4000";
      } else {
        throw new Error("API URL er ikke konfigurert, sjekk INTERNAL_API_URL i docker-compose.dev eller NEXT_PUBLIC_API_URL i .env filen.");
      }
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
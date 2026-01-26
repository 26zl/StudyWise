import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["common"],
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  async rewrites() {
    // Bruker miljøvariabel for API URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      throw new Error("NEXT_PUBLIC_API_URL mangler i miljøvariabler");
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
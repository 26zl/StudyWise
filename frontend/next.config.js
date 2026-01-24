/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["common"],
  output: "standalone",
  async rewrites() {
    // Bruker miljøvariabel for API URL, med fallback til localhost
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

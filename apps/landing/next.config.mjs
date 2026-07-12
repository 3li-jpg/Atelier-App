/** @type {import('next').NextConfig} */
export default {
  images: { unoptimized: true },
  async rewrites() {
    const api = process.env.API_URL ?? "http://localhost:3000";
    return [
      { source: "/auth/:path*", destination: `${api}/auth/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

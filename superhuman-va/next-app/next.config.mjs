/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a minimal /app/.next/standalone bundle
  // used by the production Dockerfile on Oracle ARM.
  output: "standalone",
  reactStrictMode: true,
  // Allow streaming responses up to 60s (default is 30s in some envs).
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow streaming responses up to 60s (default is 30s in some envs).
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;

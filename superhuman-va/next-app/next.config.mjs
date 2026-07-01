/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a minimal /app/.next/standalone bundle.
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
    // These packages either (a) use dynamic require() to load platform-
    // specific .node binaries (transformers/onnx) or (b) read process.* at
    // import time (supabase-js). Marking them as external leaves them out
    // of the webpack bundle so the runtime Node.js loader handles them.
    serverComponentsExternalPackages: [
      "@xenova/transformers",
      "onnxruntime-node",
      "@supabase/supabase-js",
      "@supabase/ssr",
    ],
  },
  webpack: (config) => {
    const externals = Array.isArray(config.externals) ? config.externals : [config.externals];
    externals.push({
      "@xenova/transformers": "commonjs @xenova/transformers",
      "onnxruntime-node": "commonjs onnxruntime-node",
    });
    config.externals = externals;
    return config;
  },
  compress: false,
};

export default nextConfig;

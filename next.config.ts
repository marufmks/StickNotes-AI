import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone + a minimal server.js that runs WITHOUT a full
  // node_modules. This is what lets the Dockerfile's `runner` stage ship a
  // trimmed runtime instead of your whole dependency tree.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

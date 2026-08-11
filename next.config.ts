import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray package-lock.json in the home directory
  // otherwise makes Next infer the wrong root (and could mis-load .env.local).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;

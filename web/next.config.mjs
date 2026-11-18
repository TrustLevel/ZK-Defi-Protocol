// Static export in production (Caddy serves the files; the backend serves /api).
// In development, /api is proxied to the local backend (API_URL).
import path from "path";
import { fileURLToPath } from "url";

const isDev = process.env.NODE_ENV !== "production";

export default {
  // the repo root: the app imports packages/protocol from outside web/
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  output: isDev ? undefined : "export",
  images: { unoptimized: true },
  async rewrites() {
    if (!isDev) return [];
    return [{ source: "/api/:path*", destination: `${process.env.API_URL || "http://127.0.0.1:3101"}/api/:path*` }];
  },
  webpack: (config, { isServer }) => {
    // Mesh (Cardano serialization) and snarkjs load WebAssembly.
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };
    if (!isServer) {
      // Node built-ins referenced by code paths the browser never takes.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, os: false, crypto: false, readline: false, constants: false, worker_threads: false,
      };
    }
    return config;
  },
};

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@mcp-tool-guard/gateway": resolve(__dirname, "../gateway/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Guard proxy (#12) → flight upstream on :8000 (see `make proxy` + `make flight`)
      "/mcp": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/audit": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});

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
      "/mcp": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});

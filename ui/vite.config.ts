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
      // Guard proxy (#12) + agent gateway admin API
      "/mcp": { target: "http://localhost:8787", changeOrigin: true },
      "^/([a-zA-Z0-9_-]+)/mcp": { target: "http://localhost:8787", changeOrigin: true },
      "/audit": { target: "http://localhost:8787", changeOrigin: true },
      "/servers": { target: "http://localhost:8787", changeOrigin: true },
      "/agents": {
        target: "http://localhost:8787",
        changeOrigin: true,
        bypass(req) {
          // Let Vite serve agents.html; only proxy API paths (POST/DELETE /agents/...)
          if (req.url?.endsWith(".html")) return req.url;
        },
      },
      "/token": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
      "/flight": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        agents: resolve(__dirname, "agents.html"),
      },
    },
  },
});

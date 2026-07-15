/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed dev port and no cleared screen so it can detect readiness.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Single source of truth for demo data, shared with the marketing site.
      "@shared": path.resolve(__dirname, "../shared/demo-data"),
    },
  },
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the Rust source tree.
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // Allow importing the repo-root `shared/` demo-data during dev.
      allow: [path.resolve(__dirname, ".."), __dirname],
    },
  },
  // Produce a build the Tauri webview can load from disk.
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
  // Unit tests (vitest). Pure logic runs in Node; aliases above apply here too.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

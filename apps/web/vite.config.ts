import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({ plugins: [react(), tailwindcss()], server: { port: 5173, proxy: { "/api": { target: "http://localhost:8787", rewrite: (path) => path.replace(/^\/api/, "") } } }, build: { rollupOptions: { output: { manualChunks: { charts: ["recharts"], react: ["react", "react-dom", "react-router-dom"] } } } }, test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", exclude: ["e2e/**", "node_modules/**", "dist/**"] } });

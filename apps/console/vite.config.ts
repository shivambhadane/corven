import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the API at /console in production; in development Vite proxies /api to the API on :3001.
export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001", "/health": "http://127.0.0.1:3001" } },
  build: { outDir: "dist", emptyOutDir: true },
});

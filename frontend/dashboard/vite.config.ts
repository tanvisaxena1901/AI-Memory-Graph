import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/AI-Memory-Graph/" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/actuator": "http://localhost:8080",
      "/telemetry-api": {
        target: "http://localhost:8081",
        rewrite: (path) => path.replace(/^\/telemetry-api/, "/api")
      }
    }
  }
});

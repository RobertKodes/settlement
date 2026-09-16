import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": { target: process.env.API_URL ?? "http://localhost:3000", changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/v1": { target: process.env.API_URL ?? "http://localhost:3000", changeOrigin: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 43910,
    strictPort: true,
    allowedHosts: ["food-deliveries.fv"],
  },
  preview: {
    host: "127.0.0.1",
    port: 43910,
    strictPort: true,
    allowedHosts: ["food-deliveries.fv"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});

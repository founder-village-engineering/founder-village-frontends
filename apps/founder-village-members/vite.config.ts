import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^react-native$/, replacement: "react-native-web" }],
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 43911,
    strictPort: true,
    allowedHosts: ["members.fv"],
    watch: {
      ignored: ["**/.expo/**", "**/.state/**", "**/android/**", "**/ios/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 43911,
    strictPort: true,
    allowedHosts: ["members.fv"],
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});

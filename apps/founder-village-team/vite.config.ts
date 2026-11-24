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
    port: 43912,
    strictPort: true,
    allowedHosts: ["team.fv"],
  },
  preview: {
    host: "127.0.0.1",
    port: 43912,
    strictPort: true,
    allowedHosts: ["team.fv"],
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});

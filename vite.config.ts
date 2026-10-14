import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7800,
    proxy: {
      "/api": { target: "http://127.0.0.1:7801", changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2500 },
});

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
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // libraries change far less often than the app: separate chunks stay cached across updates
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (/node_modules\/(tone|standardized-audio-context|automation-events)\//.test(id)) return "vendor-audio";
          return "vendor";
        },
      },
    },
  },
});

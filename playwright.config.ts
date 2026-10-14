import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:7802",
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command: "node scripts/start.mjs --port 7802 --api-port 7803 --no-open",
    url: "http://127.0.0.1:7802/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: { ...devices["iPhone 13"], baseURL: "http://127.0.0.1:5175" },
  webServer: {
    command: "vite --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: "SIGINT", timeout: 500 },
  },
});

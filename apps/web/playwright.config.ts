import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", use: { ...devices["iPhone 13"], baseURL: "http://127.0.0.1:5173" }, webServer: { command: "pnpm exec vite --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI } });

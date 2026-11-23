import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:43910",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:food-deliveries",
      url: "http://127.0.0.1:43910",
      reuseExistingServer: true,
    },
    {
      command: "npm run dev:members",
      url: "http://127.0.0.1:43911",
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run build && node dist/server/cli.js --no-open --port 4173 --provider fake --recording test/fixtures/recordings/basic-tour.jsonl test/fixtures/basic",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});

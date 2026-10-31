import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

process.env.MIYAGI_E2E_FOLDER ??= join(tmpdir(), `miyagi-e2e-${randomUUID()}`);
const project = join(process.env.MIYAGI_E2E_FOLDER, "basic");
const copyFixture = `node -e "require('node:fs').cpSync('test/fixtures/basic', process.argv[1], { recursive: true })" "${project}"`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalTeardown: "./e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${copyFixture} && npm run build && node dist/server/cli.js --no-open --port 4173 --provider fake --recording test/fixtures/recordings/basic-tour.jsonl "${project}"`,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});

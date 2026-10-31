import { rm } from "node:fs/promises";

export default async function teardown() {
  const folder = process.env.MIYAGI_E2E_FOLDER;
  if (folder) await rm(folder, { recursive: true, force: true, maxRetries: 5 });
}

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  root: "src/web",
  plugins: [svelte()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  test: {
    root: import.meta.dirname,
    exclude: [...configDefaults.exclude, "test/fixtures/**"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 15_000,
  },
});

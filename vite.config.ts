import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

function voiceDetectorFiles(): Plugin {
  const vadFolder = dirname(createRequire(import.meta.url).resolve("@ricky0123/vad-web"));
  const runtimeFolder = dirname(
    createRequire(join(vadFolder, "index.js")).resolve("onnxruntime-web/wasm"),
  );
  const files = [
    join(vadFolder, "vad.worklet.bundle.min.js"),
    join(vadFolder, "silero_vad_v5.onnx"),
    join(runtimeFolder, "ort-wasm-simd-threaded.wasm"),
    join(runtimeFolder, "ort-wasm-simd-threaded.mjs"),
  ];
  return {
    name: "voice-detector-files",
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: "asset",
          fileName: `vad/${basename(file)}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

export default defineConfig({
  root: "src/web",
  plugins: [svelte(), voiceDetectorFiles()],
  worker: { format: "es" },
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

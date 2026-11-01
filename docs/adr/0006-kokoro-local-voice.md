# 0006. Kokoro local voice with a bundled ONNX runtime

Date: 2026-11-01

## Context

Phase 9 needs a natural voice that runs without a cloud service. The only network calls Miyagi may make go to the LLM provider, ElevenLabs (opt-in), public GitHub clones and model downloads. By default, transformers.js loads its ONNX runtime `.wasm` from jsDelivr, which is not on that list.

## Decision

`--voice kokoro` runs Kokoro-82M through `kokoro-js` 1.2.1 in a Web Worker, with the voice `af_heart`. Piper was rejected: its quality is lower, and it needs a separate runtime. The worker clears transformers' jsDelivr `wasmPaths`, so the runtime's `.wasm` (about 21.6 MB) is bundled into `dist/web/assets` and served by the local server. Only the model and voice files come from Hugging Face. `kokoro-js` and `@huggingface/transformers` 3.8.1 are dev dependencies because Vite bundles them, which keeps `onnxruntime-node` and `sharp` out of `npx askmiyagi`.

## Consequences

The published package grows by about 24 MB. The first use downloads about 90 MB (`q8` on wasm) or about 330 MB (`fp32` on WebGPU), after which the files are cached. Whisper (Phase 9) can reuse the same bundled runtime. `kokoro-js` 1.2.1 pins transformers to 3.x and hardcodes the Hugging Face voice URL. Revisit when a newer `kokoro-js` release supports transformers 4 or a custom voice location.

# 0009. Chatterbox as an opt-in local voice

Date: 2026-11-07

## Context

Kokoro ([ADR 0006](0006-kokoro-local-voice.md)) is small and fast, but the owner finds it robotic, and ElevenLabs credits run out. The most natural open voice that runs in a browser is Resemble AI's Chatterbox (MIT weights). It runs only on `@huggingface/transformers` 4.x and needs WebGPU. Its download is about 1.5 GB. `kokoro-js` still needs transformers.js 3.x.

## Decision

Add `--voice chatterbox` as an opt-in voice in its own Web Worker. It runs on transformers.js 4.3.2, installed under the npm alias `huggingface-transformers-4`. Kokoro and Whisper keep 3.8.1. Kokoro stays the default.

We rejected moving everything to 4.x. `kokoro-js` would keep its own nested 3.x copy, and Miyagi's runtime settings, which serve the ONNX files locally, would no longer reach it. We also rejected running Chatterbox on the CPU, because it is too slow to narrate.

## Consequences

The page downloads only the voice in use. The Chatterbox worker also bundles parts of the 3.x library through the shared worker code, which makes it a few MB larger but loads nothing from the network. The build is larger, and two transformers.js versions must be updated with care. Chatterbox's first word is slower than Kokoro's, and machines without WebGPU fall back to the system voice. Building its GPU sessions takes about two minutes on each launch and blocks the worker, so the worker downloads every weight file into the cache before it builds any. Revisit this when `kokoro-js` supports transformers.js 4.x: then drop the alias and use one version.

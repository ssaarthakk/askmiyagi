import { AutoProcessor, ChatterboxModel, env, Tensor } from "huggingface-transformers-4";
import {
  cacheModelFile,
  chatterboxSampleRate,
  chatterboxVoice,
  requireHalfFloats,
} from "./chatterbox-speech.ts";
import { speakSentences } from "./kokoro-speech.ts";
import { serveModel } from "./model-worker.ts";
import { wavSamples } from "./wav.ts";

const modelId = "onnx-community/chatterbox-ONNX";
const dtype = {
  embed_tokens: "fp32",
  speech_encoder: "fp32",
  language_model: "q4f16",
  conditional_decoder: "fp32",
} as const;
const referenceVoice = "default_voice.wav";
const modelFiles = [
  referenceVoice,
  ...Object.entries(dtype).flatMap(([part, type]) => {
    const graph = `onnx/${part}${type === "fp32" ? "" : `_${type}`}.onnx`;
    return [graph, `${graph}_data`];
  }),
];
const fileUrl = (file: string) => `https://huggingface.co/${modelId}/resolve/main/${file}`;

if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = undefined;

serveModel(
  async ({ device, progress_callback }) => {
    if (device !== "webgpu") throw new Error("Chatterbox needs WebGPU");
    await requireHalfFloats((navigator as { gpu?: Parameters<typeof requireHalfFloats>[0] }).gpu);
    const cache = await caches.open(env.cacheKey);
    await Promise.all(
      modelFiles.map((file) => cacheModelFile(cache, fileUrl(file), file, progress_callback)),
    );
    const [model, processor, reference] = await Promise.all([
      ChatterboxModel.from_pretrained(modelId, { device, dtype }) as Promise<ChatterboxModel>,
      AutoProcessor.from_pretrained(modelId),
      cache.match(fileUrl(referenceVoice)).then((response) => response?.arrayBuffer()),
    ]);
    if (!reference) throw new Error("The voice sample is missing from the cache");
    const { samples, sampleRate } = wavSamples(reference);
    if (sampleRate !== chatterboxSampleRate) throw new Error("The voice sample is not 24 kHz");
    const speaker = await model.encode_speech(new Tensor("float32", samples, [1, samples.length]));
    return chatterboxVoice(model, processor, speaker);
  },
  (voice, text: string, signal) => speakSentences(voice, text, signal),
);

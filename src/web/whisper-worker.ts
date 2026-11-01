import { pipeline } from "@huggingface/transformers";
import { serveModel } from "./model-worker.ts";

const modelId = "Xenova/whisper-base.en";
const chunkSeconds = 30;

serveModel(
  (options) => pipeline("automatic-speech-recognition", modelId, options),
  async (model, samples: Float32Array) => {
    const result = await model(samples, { chunk_length_s: chunkSeconds });
    const text = (Array.isArray(result) ? result[0]?.text : result.text) ?? "";
    return text.trim();
  },
);

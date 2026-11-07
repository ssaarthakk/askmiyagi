import { KokoroTTS } from "kokoro-js";
import { speakText } from "./kokoro-speech.ts";
import { serveModel } from "./model-worker.ts";

const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";

serveModel(
  (options) => KokoroTTS.from_pretrained(modelId, options),
  (model, text: string, signal) => speakText(model, text, signal),
);

import { KokoroTTS } from "kokoro-js";
import { serveModel } from "./model-worker.ts";

const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
const voice = "af_heart";

serveModel(
  (options) => KokoroTTS.from_pretrained(modelId, options),
  async (model, text: string) => (await model.generate(text, { voice })).toBlob(),
);

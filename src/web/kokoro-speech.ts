import { encodeWav } from "./wav.ts";

const voice = "af_heart";

type Clip = { audio: Float32Array; sampling_rate: number };
type SpeechModel = { generate(text: string, options: { voice: typeof voice }): Promise<Clip> };

export async function speakText(model: SpeechModel, text: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const clip = await model.generate(text, { voice });
  signal.throwIfAborted();
  return encodeWav(clip.audio, clip.sampling_rate);
}

import { createModelEngine, type ModelEngine } from "./model-download.ts";

type WhisperEngine = ModelEngine<Float32Array, string>;

const sampleRate = 16000;

export function startWhisper(onProgress: (percent: number) => void): WhisperEngine {
  const worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
  return createModelEngine(worker, onProgress, "Speech-to-text stopped");
}

export async function decodeRecording(recording: Blob) {
  const context = new AudioContext({ sampleRate });
  try {
    const audio = await context.decodeAudioData(await recording.arrayBuffer());
    return audio.getChannelData(0);
  } finally {
    await context.close();
  }
}

export function createLocalTranscriber(
  start: (onProgress: (percent: number) => void) => WhisperEngine,
  decode: (recording: Blob) => Promise<Float32Array>,
) {
  let engine: WhisperEngine | undefined;
  let notify: (text: string) => void = () => {};
  return async (recording: Blob, notifyCaller: (text: string) => void) => {
    notify = notifyCaller;
    engine ??= start((percent) => notify(`Downloading the speech model: ${percent}%`));
    try {
      await engine.ready;
    } catch (error) {
      engine = undefined;
      throw error;
    }
    const samples = await decode(recording);
    return engine.run(samples, [samples.buffer]);
  };
}

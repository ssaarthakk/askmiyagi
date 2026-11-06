import { TextSplitterStream } from "kokoro-js";
import { encodeWav } from "./wav.ts";

const voice = "af_heart";
const kokoroSampleRate = 24000;

type Clip = { audio: Float32Array; sampling_rate: number };
type SentenceModel = { generate(text: string, options: { voice: typeof voice }): Promise<Clip> };

function sentencesOf(text: string) {
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  return splitter.sentences;
}

function join(clips: Clip[]) {
  const audio = new Float32Array(clips.reduce((length, clip) => length + clip.audio.length, 0));
  let offset = 0;
  for (const clip of clips) {
    audio.set(clip.audio, offset);
    offset += clip.audio.length;
  }
  return encodeWav(audio, clips[0]?.sampling_rate ?? kokoroSampleRate);
}

export async function speakSentences(model: SentenceModel, text: string, signal: AbortSignal) {
  const clips: Clip[] = [];
  for (const sentence of sentencesOf(text)) {
    signal.throwIfAborted();
    clips.push(await model.generate(sentence, { voice }));
  }
  signal.throwIfAborted();
  return join(clips);
}

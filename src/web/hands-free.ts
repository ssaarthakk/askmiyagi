import { openMicrophone } from "./recorder.ts";

export type Detection = {
  onSpeechStart: () => void;
  onVADMisfire: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
};

export type Detector = { start(): Promise<void>; pause(): Promise<void> };

const sampleRate = 16_000;
const assetPath = "/vad/";

export async function startDetector(detection: Detection): Promise<Detector> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  return MicVAD.new({
    ...detection,
    model: "v5",
    minSpeechMs: 300,
    redemptionMs: 650,
    baseAssetPath: assetPath,
    onnxWASMBasePath: assetPath,
    getStream: openMicrophone,
    resumeStream: openMicrophone,
  });
}

export function chooseDetector() {
  const injected = (window as { __MIYAGI_DETECTOR__?: typeof startDetector }).__MIYAGI_DETECTOR__;
  return injected ?? startDetector;
}

export function encodeWav(samples: Float32Array) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => {
    for (const [index, char] of [...value].entries()) view.setUint8(at + index, char.charCodeAt(0));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (const [index, sample] of samples.entries()) {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

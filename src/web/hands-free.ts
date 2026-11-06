import { openMicrophone } from "./recorder.ts";

export type Detection = {
  onSpeechStart: () => void;
  onVADMisfire: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
};

export type Detector = { start(): Promise<void>; pause(): Promise<void> };

export const detectorSampleRate = 16_000;
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

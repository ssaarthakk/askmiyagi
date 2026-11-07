export const chatterboxSampleRate = 24_000;
const exaggeration = 0.5;
const maxNewTokens = 1000;

type Inputs = Record<string, unknown>;
type Generator = { generate(inputs: Inputs): Promise<unknown> };
type Processor = (text: string) => Promise<Inputs>;
type ModelCache = Pick<Cache, "match" | "put">;
type Progress = (event: { status: string; file: string; loaded: number; total: number }) => void;
type Gpu = { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };

export function chatterboxVoice(model: Generator, processor: Processor, speaker: Inputs) {
  return {
    async generate(text: string) {
      const waveform = await model.generate({
        ...(await processor(text)),
        ...speaker,
        exaggeration,
        max_new_tokens: maxNewTokens,
      });
      return {
        audio: (waveform as { data: Float32Array }).data,
        sampling_rate: chatterboxSampleRate,
      };
    },
  };
}

export async function requireHalfFloats(gpu: Gpu | undefined) {
  const adapter = await gpu?.requestAdapter();
  if (!adapter?.features.has("shader-f16")) {
    throw new Error("Chatterbox needs a GPU with 16-bit float shaders");
  }
}

export async function cacheModelFile(
  cache: ModelCache,
  url: string,
  file: string,
  progress: Progress,
) {
  if (await cache.match(url)) return;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${file} (${response.status})`);
  }
  const total = Number(response.headers.get("content-length"));
  let loaded = 0;
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.length;
      if (total) progress({ status: "progress", file, loaded, total });
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (total && loaded !== total) {
        controller.error(new Error(`The download of ${file} was cut short`));
      }
    },
  });
  await cache.put(url, new Response(response.body.pipeThrough(counted), response));
}

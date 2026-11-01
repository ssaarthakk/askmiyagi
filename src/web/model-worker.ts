import { env } from "@huggingface/transformers";
import { createProgressReporter, type ModelReply, type ModelRequest } from "./model-download.ts";

type LoadOptions = {
  device: "webgpu" | "wasm";
  dtype: "fp32" | "q8";
  progress_callback: ReturnType<typeof createProgressReporter>;
};

async function gpuAvailable() {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return Boolean(await gpu?.requestAdapter().catch(() => null));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function serveModel<Model, Input, Result>(
  load: (options: LoadOptions) => Promise<Model>,
  handle: (model: Model, input: Input, signal: AbortSignal) => Promise<Result>,
) {
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = undefined;
  const reply = (message: ModelReply<Result>) => self.postMessage(message);

  const model = gpuAvailable().then((webgpu) =>
    load({
      device: webgpu ? "webgpu" : "wasm",
      dtype: webgpu ? "fp32" : "q8",
      progress_callback: createProgressReporter((percent) => reply({ type: "progress", percent })),
    }),
  );
  model.then(
    () => reply({ type: "ready" }),
    (error: unknown) => reply({ type: "failed", message: messageOf(error) }),
  );

  const requests = new Map<number, AbortController>();
  let queue: Promise<void> = Promise.resolve();
  self.addEventListener("message", (event: MessageEvent<ModelRequest<Input>>) => {
    const request = event.data;
    if (request.type === "cancel") {
      requests.get(request.id)?.abort();
      return;
    }
    const { id, input } = request;
    const controller = new AbortController();
    requests.set(id, controller);
    queue = queue.then(async () => {
      try {
        if (controller.signal.aborted) return;
        reply({ type: "result", id, result: await handle(await model, input, controller.signal) });
      } catch (error) {
        reply({ type: "error", id, message: messageOf(error) });
      } finally {
        requests.delete(id);
      }
    });
  });
}

function downloadPercent(files: Iterable<{ loaded: number; total: number }>) {
  let loaded = 0;
  let total = 0;
  for (const file of files) {
    loaded += file.loaded;
    total += file.total;
  }
  return total === 0 ? 0 : Math.floor((loaded / total) * 10) * 10;
}

type DownloadEvent = { status: string; file?: string; loaded?: number; total?: number };

export function createProgressReporter(report: (percent: number) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  let shownPercent = -1;
  return (event: DownloadEvent) => {
    const { status, file, loaded, total } = event;
    if (
      status !== "progress" ||
      file === undefined ||
      loaded === undefined ||
      total === undefined
    ) {
      return;
    }
    files.set(file, { loaded, total });
    const percent = downloadPercent(files.values());
    if (percent === shownPercent) return;
    shownPercent = percent;
    report(percent);
  };
}

export type ModelRequest<Input> =
  | { type: "run"; id: number; input: Input }
  | { type: "cancel"; id: number };

export type ModelReply<Result> =
  | { type: "progress"; percent: number }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; result: Result }
  | { type: "error"; id: number; message: string };

export type ModelEngine<Input, Result> = {
  ready: Promise<void>;
  readonly stopped: boolean;
  run(input: Input, transfer?: Transferable[], signal?: AbortSignal): Promise<Result>;
};

type ModelWorker = Pick<Worker, "addEventListener" | "terminate"> & {
  postMessage(message: unknown, transfer: Transferable[]): void;
};

export function createModelEngine<Input, Result>(
  worker: ModelWorker,
  onProgress: (percent: number) => void,
  stoppedMessage: string,
): ModelEngine<Input, Result> {
  const waiting = new Map<
    number,
    { resolve(result: Result): void; reject(error: unknown): void }
  >();
  let nextId = 0;
  let stopped: Error | undefined;
  let loaded: { resolve(): void; reject(error: Error): void } | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    loaded = { resolve, reject };
  });

  function stop(error: Error) {
    stopped = error;
    worker.terminate();
    loaded?.reject(error);
    for (const request of waiting.values()) request.reject(error);
    waiting.clear();
  }

  function send(request: ModelRequest<Input>, transfer: Transferable[] = []) {
    worker.postMessage(request, transfer);
  }

  worker.addEventListener("message", (event: MessageEvent<ModelReply<Result>>) => {
    const reply = event.data;
    if (reply.type === "progress") onProgress(reply.percent);
    else if (reply.type === "ready") loaded?.resolve();
    else if (reply.type === "failed") stop(new Error(reply.message));
    else {
      const request = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (reply.type === "result") request?.resolve(reply.result);
      else request?.reject(new Error(reply.message));
    }
  });

  worker.addEventListener("error", () => stop(new Error(stoppedMessage)));

  return {
    ready,
    get stopped() {
      return stopped !== undefined;
    },
    run(input, transfer = [], signal) {
      if (stopped) return Promise.reject(stopped);
      if (signal?.aborted) return Promise.reject(signal.reason);
      const id = nextId++;
      return new Promise<Result>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        send({ type: "run", id, input }, transfer);
        signal?.addEventListener(
          "abort",
          () => {
            if (!waiting.delete(id)) return;
            send({ type: "cancel", id });
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  };
}

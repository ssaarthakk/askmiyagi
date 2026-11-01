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

export type ModelRequest<Input> = { id: number; input: Input };

export type ModelReply<Result> =
  | { type: "progress"; percent: number }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; result: Result }
  | { type: "error"; id: number; message: string };

export type ModelEngine<Input, Result> = {
  ready: Promise<void>;
  run(input: Input, transfer?: Transferable[]): Promise<Result>;
};

type ModelWorker = Pick<Worker, "addEventListener"> & {
  postMessage(message: unknown, transfer: Transferable[]): void;
};

export function createModelEngine<Input, Result>(
  worker: ModelWorker,
  onProgress: (percent: number) => void,
  stoppedMessage: string,
): ModelEngine<Input, Result> {
  const waiting = new Map<number, { resolve(result: Result): void; reject(error: Error): void }>();
  let nextId = 0;
  let loaded: { resolve(): void; reject(error: Error): void } | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    loaded = { resolve, reject };
  });

  worker.addEventListener("message", (event: MessageEvent<ModelReply<Result>>) => {
    const reply = event.data;
    if (reply.type === "progress") onProgress(reply.percent);
    else if (reply.type === "ready") loaded?.resolve();
    else if (reply.type === "failed") loaded?.reject(new Error(reply.message));
    else {
      const request = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (reply.type === "result") request?.resolve(reply.result);
      else request?.reject(new Error(reply.message));
    }
  });

  worker.addEventListener("error", () => {
    const stopped = new Error(stoppedMessage);
    loaded?.reject(stopped);
    for (const request of waiting.values()) request.reject(stopped);
    waiting.clear();
  });

  return {
    ready,
    run(input, transfer = []) {
      const id = nextId++;
      return new Promise<Result>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, input } satisfies ModelRequest<Input>, transfer);
      });
    },
  };
}

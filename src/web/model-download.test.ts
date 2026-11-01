import { describe, expect, it, vi } from "vitest";
import {
  createModelEngine,
  createProgressReporter,
  type ModelReply,
  type ModelRequest,
} from "./model-download.ts";

describe("createProgressReporter", () => {
  it("reports the combined percent of all files, once per step", () => {
    const report = vi.fn();
    const onProgress = createProgressReporter(report);

    onProgress({ status: "progress", file: "a", loaded: 0, total: 100 });
    onProgress({ status: "progress", file: "a", loaded: 5, total: 100 });
    onProgress({ status: "progress", file: "b", loaded: 100, total: 100 });
    onProgress({ status: "progress", file: "a", loaded: 100, total: 100 });

    expect(report.mock.calls).toEqual([[0], [50], [100]]);
  });

  it("ignores events that are not progress", () => {
    const report = vi.fn();

    createProgressReporter(report)({ status: "done", file: "a" });

    expect(report).not.toHaveBeenCalled();
  });
});

describe("createModelEngine", () => {
  const onProgress = vi.fn();

  function fakeWorker() {
    const requests: { request: ModelRequest<string>; transfer: Transferable[] }[] = [];
    const worker = Object.assign(new EventTarget(), {
      terminate: vi.fn(),
      postMessage: (request: ModelRequest<string>, transfer: Transferable[]) =>
        requests.push({ request, transfer }),
    });
    const reply = (data: ModelReply<string>) =>
      worker.dispatchEvent(new MessageEvent("message", { data }));
    const idOf = (input: string) =>
      requests.find(({ request }) => request.type === "run" && request.input === input)?.request
        .id ?? -1;
    const engine = createModelEngine<string, string>(worker, onProgress, "The model stopped");
    return { worker, requests, reply, idOf, engine };
  }

  it("sends each input to the worker and resolves each with its own result", async () => {
    const { requests, reply, idOf, engine } = fakeWorker();
    const buffer = new ArrayBuffer(1);

    const first = engine.run("one", [buffer]);
    const second = engine.run("two");
    reply({ type: "result", id: idOf("two"), result: "result-two" });
    reply({ type: "result", id: idOf("one"), result: "result-one" });

    await expect(first).resolves.toBe("result-one");
    await expect(second).resolves.toBe("result-two");
    expect(requests.map(({ transfer }) => transfer)).toEqual([[buffer], []]);
  });

  it("fails a request with the worker's error message", async () => {
    const { reply, idOf, engine } = fakeWorker();

    const result = engine.run("one");
    reply({ type: "error", id: idOf("one"), message: "generation failed" });

    await expect(result).rejects.toThrow("generation failed");
  });

  it("fails the load and every waiting request when the worker crashes", async () => {
    const { worker, engine } = fakeWorker();

    const result = engine.run("one");
    worker.dispatchEvent(new Event("error"));

    await expect(result).rejects.toThrow("The model stopped");
    await expect(engine.ready).rejects.toThrow("The model stopped");
  });

  it("reports download progress and becomes ready when the model has loaded", async () => {
    const { reply, engine } = fakeWorker();

    reply({ type: "progress", percent: 40 });
    reply({ type: "ready" });

    expect(onProgress).toHaveBeenCalledWith(40);
    await expect(engine.ready).resolves.toBeUndefined();
  });

  it("rejects ready with the reason when the model cannot load", async () => {
    const { reply, engine } = fakeWorker();

    reply({ type: "failed", message: "no network" });

    await expect(engine.ready).rejects.toThrow("no network");
  });

  it("stops the worker when the model cannot load", async () => {
    const { worker, reply, engine } = fakeWorker();

    reply({ type: "failed", message: "no network" });

    await expect(engine.ready).rejects.toThrow("no network");
    expect(worker.terminate).toHaveBeenCalled();
    expect(engine.stopped).toBe(true);
  });

  it("fails new requests at once after the worker crashed, without waiting for a reply", async () => {
    const { worker, requests, reply, engine } = fakeWorker();
    reply({ type: "ready" });
    await engine.ready;

    worker.dispatchEvent(new Event("error"));

    await expect(engine.run("two")).rejects.toThrow("The model stopped");
    expect(requests).toEqual([]);
    expect(worker.terminate).toHaveBeenCalled();
    expect(engine.stopped).toBe(true);
  });

  it("cancels a request in the worker when its signal aborts", async () => {
    const { requests, reply, idOf, engine } = fakeWorker();
    const controller = new AbortController();

    const result = engine.run("one", [], controller.signal);
    controller.abort();
    reply({ type: "result", id: idOf("one"), result: "too late" });

    await expect(result).rejects.toThrow();
    expect(requests.map(({ request }) => request)).toContainEqual({
      type: "cancel",
      id: idOf("one"),
    });
  });
});

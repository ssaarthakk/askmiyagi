import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelReply, ModelRequest } from "./model-download.ts";
import { serveModel } from "./model-worker.ts";

function fakeWorkerScope() {
  const scope = new EventTarget();
  const replies: ModelReply<string>[] = [];
  vi.stubGlobal(
    "self",
    Object.assign(scope, { postMessage: (reply: ModelReply<string>) => replies.push(reply) }),
  );
  const send = (data: ModelRequest<string>) =>
    scope.dispatchEvent(new MessageEvent("message", { data }));
  return { replies, send };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serveModel", () => {
  it("skips a request that was cancelled while it waited in the queue", async () => {
    const { replies, send } = fakeWorkerScope();
    let finishFirst: () => void = () => {};
    const handle = vi.fn((_model: string, input: string) =>
      input === "one"
        ? new Promise<string>((resolve) => {
            finishFirst = () => resolve("ONE");
          })
        : Promise.resolve(input.toUpperCase()),
    );
    serveModel(async () => "model", handle);

    send({ type: "run", id: 0, input: "one" });
    send({ type: "run", id: 1, input: "two" });
    send({ type: "run", id: 2, input: "three" });
    send({ type: "cancel", id: 1 });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce());
    finishFirst();

    await vi.waitFor(() =>
      expect(replies).toContainEqual({ type: "result", id: 2, result: "THREE" }),
    );
    expect(handle.mock.calls.map(([, input]) => input)).toEqual(["one", "three"]);
  });

  it("aborts the signal of a running request when it is cancelled", async () => {
    const { send } = fakeWorkerScope();
    const signals: AbortSignal[] = [];
    serveModel(
      async () => "model",
      (_model: string, _input: string, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<string>(() => {});
      },
    );

    send({ type: "run", id: 0, input: "one" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    send({ type: "cancel", id: 0 });

    expect(signals[0]?.aborted).toBe(true);
  });
});

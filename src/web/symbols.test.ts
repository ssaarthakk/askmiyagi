import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSymbols } from "./symbols.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSymbols", () => {
  it("asks the server with the token and returns the symbols", async () => {
    const stub = vi.fn(async () => Response.json({ symbols: ["runCli", "uploadClip"] }));
    vi.stubGlobal("fetch", stub);

    const symbols = await fetchSymbols("tok");

    expect(symbols).toEqual(["runCli", "uploadClip"]);
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/symbols");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
  });

  it("throws the server's error message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Forbidden" }, { status: 403 }));

    await expect(fetchSymbols("tok")).rejects.toThrow("Forbidden");
  });

  it("throws when the answer is not a symbol list", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ symbols: "runCli" }));

    await expect(fetchSymbols("tok")).rejects.toThrow();
  });
});

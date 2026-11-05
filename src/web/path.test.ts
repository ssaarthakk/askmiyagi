import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPath, postPlan } from "./path.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const item = { concept: "Storage", question: "How is it stored?", file: "src/store.ts" };
const reply = { items: [{ ...item, done: false }] };

function stubFetch(response: () => Response) {
  const stub = vi.fn(async () => response());
  vi.stubGlobal("fetch", stub);
  return () => stub.mock.calls[0] as unknown as [string, RequestInit | undefined];
}

describe("fetchPath", () => {
  it("gets the path with the token, and answers null when there is none", async () => {
    const call = stubFetch(() => Response.json(null));

    expect(await fetchPath("tok")).toBeNull();

    const [url, init] = call();
    expect(url).toBe("/api/path");
    expect(init?.headers).toMatchObject({ "x-miyagi-token": "tok" });
  });

  it("returns the parsed path, and throws on a bad reply or the server's error", async () => {
    stubFetch(() => Response.json(reply));
    expect(await fetchPath("tok")).toEqual(reply);

    stubFetch(() => Response.json({ items: [{ concept: 3 }] }));
    await expect(fetchPath("tok")).rejects.toThrow();

    stubFetch(() => Response.json({ error: "Broken" }, { status: 500 }));
    await expect(fetchPath("tok")).rejects.toThrow("Broken");
  });
});

describe("postPlan", () => {
  it("posts an empty body with the token and returns the new path", async () => {
    const call = stubFetch(() => Response.json(reply));

    expect(await postPlan("tok")).toEqual(reply);

    const [url, init] = call();
    expect(url).toBe("/api/path");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-miyagi-token": "tok" });
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("throws the server's error message", async () => {
    stubFetch(() => Response.json({ error: "Set a goal first" }, { status: 400 }));

    await expect(postPlan("tok")).rejects.toThrow("Set a goal first");
  });
});

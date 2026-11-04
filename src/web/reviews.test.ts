import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDue, postExplainBack, postReviewSkipped } from "./reviews.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = {
  outcome: "passed",
  score: 5,
  gaps: [],
  ranges: [],
  modelAnswer: null,
};

function stubFetch(response: () => Response) {
  const stub = vi.fn(async () => response());
  vi.stubGlobal("fetch", stub);
  return () => stub.mock.calls[0] as unknown as [string, RequestInit];
}

describe("postExplainBack", () => {
  it("posts the concept, the answer and the review flag with the token, and returns the parsed reply", async () => {
    const call = stubFetch(() => Response.json(reply));

    expect(await postExplainBack("Upload retries", "It retries", true, "tok")).toEqual(reply);

    const [url, init] = call();
    expect(url).toBe("/api/explain-back");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
    expect(JSON.parse(String(init.body))).toEqual({
      concept: "Upload retries",
      answer: "It retries",
      review: true,
    });
  });

  it("throws the server's error message", async () => {
    stubFetch(() => Response.json({ error: "Rate limited" }, { status: 502 }));

    await expect(postExplainBack("Upload retries", "x", false, "tok")).rejects.toThrow(
      "Rate limited",
    );
  });

  it("throws when the reply is not a grade", async () => {
    stubFetch(() => Response.json({ outcome: "great" }));

    await expect(postExplainBack("Upload retries", "x", false, "tok")).rejects.toThrow();
  });
});

describe("postReviewSkipped", () => {
  it("posts the concept with the token", async () => {
    const call = stubFetch(() => new Response(null, { status: 204 }));

    await postReviewSkipped("Upload retries", "tok");

    const [url, init] = call();
    expect(url).toBe("/api/review-skipped");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
    expect(JSON.parse(String(init.body))).toEqual({ concept: "Upload retries" });
  });

  it("throws when the server refuses", async () => {
    stubFetch(() => new Response(null, { status: 500 }));

    await expect(postReviewSkipped("Upload retries", "tok")).rejects.toThrow("status 500");
  });
});

describe("fetchDue", () => {
  it("asks the server with the token and returns the due concepts", async () => {
    const call = stubFetch(() => Response.json({ due: ["Upload retries"] }));

    expect(await fetchDue("tok")).toEqual(["Upload retries"]);

    const [url, init] = call();
    expect(url).toBe("/api/reviews");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
  });

  it("throws the server's error message and rejects a bad list", async () => {
    stubFetch(() => Response.json({ error: "Forbidden" }, { status: 403 }));
    await expect(fetchDue("tok")).rejects.toThrow("Forbidden");

    stubFetch(() => Response.json({ due: "Upload retries" }));
    await expect(fetchDue("tok")).rejects.toThrow();
  });
});

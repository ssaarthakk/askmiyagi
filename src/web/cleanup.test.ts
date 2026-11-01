import { describe, expect, it, vi } from "vitest";
import { cleanTranscript, withCleanup } from "./cleanup.ts";

describe("withCleanup", () => {
  const recording = new Blob([new Uint8Array([1])]);

  it("cleans what the transcriber heard with the repo's symbols and passes the notice callback on", async () => {
    const notify = vi.fn();
    const heard = vi.fn(async (_recording: Blob, tell: (text: string) => void) => {
      tell("Downloading");
      return "um what does upload clip do";
    });

    const text = await withCleanup(heard, async () => ["uploadClip"])(recording, notify);

    expect(text).toBe("what does uploadClip do");
    expect(heard).toHaveBeenCalledWith(recording, notify);
    expect(notify).toHaveBeenCalledWith("Downloading");
  });

  it("starts loading the symbols while the recording is still being transcribed", async () => {
    const loadSymbols = vi.fn(async () => ["uploadClip"]);
    let finishHearing = (_text: string) => {};
    const heard = () =>
      new Promise<string>((resolve) => {
        finishHearing = resolve;
      });

    const cleaned = withCleanup(heard, loadSymbols)(recording, vi.fn());

    expect(loadSymbols).toHaveBeenCalledTimes(1);
    finishHearing("upload clip");
    await expect(cleaned).resolves.toBe("uploadClip");
  });

  it("fails with the symbol loading error instead of sending an uncleaned question", async () => {
    const failing = withCleanup(
      async () => "upload clip",
      async () => {
        throw new Error("Forbidden");
      },
    );

    await expect(failing(recording, vi.fn())).rejects.toThrow("Forbidden");
  });
});

describe("filler words", () => {
  it("removes um, uh, er, ah and hmm in any case, with the comma or full stop after them", () => {
    expect(cleanTranscript("Um, how does, uh, the router, er, pick a route? Ah. Hmm...", [])).toBe(
      "how does, the router, pick a route?",
    );
  });

  it("keeps 'like' and words that only contain a filler", () => {
    expect(cleanTranscript("It is like an umbrella for the hummus", [])).toBe(
      "It is like an umbrella for the hummus",
    );
  });

  it("returns an empty string when only fillers were said", () => {
    expect(cleanTranscript("Um... uh, hmm", ["uploadClip"])).toBe("");
  });
});

describe("symbol matching", () => {
  const symbols = ["parse", "runCli", "uploadClip", "uploadClips"];

  it("joins adjacent words into the symbol they spell", () => {
    expect(cleanTranscript("what does upload clip do", symbols)).toBe("what does uploadClip do");
    expect(cleanTranscript("what does Run CLI do", symbols)).toBe("what does runCli do");
  });

  it("keeps the punctuation around the matched words", () => {
    expect(cleanTranscript("Where is (upload clip)?", symbols)).toBe("Where is (uploadClip)?");
  });

  it("matches a symbol said as a single word", () => {
    expect(cleanTranscript("explain uploadclip", symbols)).toBe("explain uploadClip");
  });

  it("allows one typo in a name of 6 or more characters", () => {
    expect(cleanTranscript("explain upload clib", symbols)).toBe("explain uploadClip");
  });

  it("allows no typo in a name shorter than 6 characters", () => {
    expect(cleanTranscript("explain parsr", symbols)).toBe("explain parsr");
    expect(cleanTranscript("explain Parse", symbols)).toBe("explain parse");
  });

  it("does not match names that are two edits away", () => {
    expect(cleanTranscript("explain upload clamp now", symbols)).toBe("explain upload clamp now");
  });

  it("prefers the exact name over a name one edit away", () => {
    expect(cleanTranscript("explain upload clips", symbols)).toBe("explain uploadClips");
    expect(cleanTranscript("explain upload clip", symbols)).toBe("explain uploadClip");
  });

  it("removes fillers before matching, so a filler inside a name does not break it", () => {
    expect(cleanTranscript("um what does upload uh clip do", symbols)).toBe(
      "what does uploadClip do",
    );
  });

  it("leaves the text alone when no symbol matches or there are no symbols", () => {
    expect(cleanTranscript("how are clips saved", symbols)).toBe("how are clips saved");
    expect(cleanTranscript("how does upload clip work", [])).toBe("how does upload clip work");
  });
});

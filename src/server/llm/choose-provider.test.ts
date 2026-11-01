import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseProvider } from "./choose-provider.ts";
import { claudeApi } from "./claude-api.ts";
import { claudeHeadless } from "./claude-headless.ts";
import { geminiApi } from "./gemini-api.ts";

vi.mock("./claude-api.ts", () => ({ claudeApi: vi.fn() }));
vi.mock("./gemini-api.ts", () => ({ geminiApi: vi.fn() }));
vi.mock("./claude-headless.ts", () => ({ claudeHeadless: vi.fn() }));
vi.mock("./claude-process.ts", () => ({
  claudeNotFound: "Claude Code was not found.",
  findClaude: vi.fn(async () => "claude"),
}));

const choice = { model: "some-model", recording: undefined };

describe("chooseProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("builds ClaudeAPI with the key and the model for claude-api", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const built = { ask: vi.fn() };
    vi.mocked(claudeApi).mockReturnValue(built);
    const result = await chooseProvider({ ...choice, provider: "claude-api" });
    expect(result).toEqual({ ok: true, value: built });
    expect(claudeApi).toHaveBeenCalledWith({ apiKey: "anthropic-key", model: "some-model" });
    expect(geminiApi).not.toHaveBeenCalled();
    expect(claudeHeadless).not.toHaveBeenCalled();
  });

  it("builds GeminiAPI with the key and the model for gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    const built = { ask: vi.fn() };
    vi.mocked(geminiApi).mockReturnValue(built);
    const result = await chooseProvider({ ...choice, provider: "gemini" });
    expect(result).toEqual({ ok: true, value: built });
    expect(geminiApi).toHaveBeenCalledWith({ apiKey: "gemini-key", model: "some-model" });
    expect(claudeApi).not.toHaveBeenCalled();
    expect(claudeHeadless).not.toHaveBeenCalled();
  });

  it("builds ClaudeHeadless with the model for claude-headless", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const built = { ask: vi.fn() };
    vi.mocked(claudeHeadless).mockReturnValue(built);
    const result = await chooseProvider({ ...choice, provider: "claude-headless" });
    expect(result).toEqual({ ok: true, value: built });
    expect(claudeHeadless).toHaveBeenCalledWith("some-model");
    expect(claudeApi).not.toHaveBeenCalled();
  });
});

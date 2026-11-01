import { resolve } from "node:path";
import type { Result } from "../../shared/result.ts";
import { claudeApi } from "./claude-api.ts";
import { claudeHeadless } from "./claude-headless.ts";
import { claudeNotFound, findClaude } from "./claude-process.ts";
import { loadFakeProvider } from "./fake-provider.ts";
import { geminiApi } from "./gemini-api.ts";
import type { LLMProvider } from "./provider.ts";

type ProviderChoice = {
  provider: "claude-headless" | "claude-api" | "gemini" | "fake";
  model?: string | undefined;
  recording?: string | undefined;
};

function needsKey(name: string, provider: string): Result<string> {
  const value = process.env[name];
  return value
    ? { ok: true, value }
    : { ok: false, error: `Set ${name} to use --provider ${provider}` };
}

export async function chooseProvider({
  provider,
  model,
  recording,
}: ProviderChoice): Promise<Result<LLMProvider>> {
  if (provider === "fake") return loadFakeProvider(resolve(recording ?? ""));
  if (provider === "claude-api") {
    const key = needsKey("ANTHROPIC_API_KEY", provider);
    return key.ok ? { ok: true, value: claudeApi({ apiKey: key.value, model }) } : key;
  }
  if (provider === "gemini") {
    const key = needsKey("GEMINI_API_KEY", provider);
    return key.ok ? { ok: true, value: geminiApi({ apiKey: key.value, model }) } : key;
  }
  if ((await findClaude(process.env)) === undefined) return { ok: false, error: claudeNotFound };
  return { ok: true, value: claudeHeadless(model) };
}

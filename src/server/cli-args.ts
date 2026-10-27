import { parseArgs } from "node:util";
import { z } from "zod";

const defaultVoiceId = "JBFqnCBsd6RMkjVDRZzb";

const cliArgsSchema = z.object({
  positionals: z.array(z.string()).max(1, "Only one project path or URL can be provided"),
  port: z
    .string()
    .regex(/^\d+$/, "Port must be an integer between 0 and 65535")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535))
    .optional(),
  noOpen: z.boolean(),
  provider: z
    .enum(["fake"], { error: (issue) => `Unknown provider: ${String(issue.input)}` })
    .optional(),
  recording: z.string().min(1).optional(),
  voice: z
    .enum(["browser", "elevenlabs"], { error: (issue) => `Unknown voice: ${String(issue.input)}` })
    .optional(),
  voiceId: z.string().min(1, "--voice-id must not be empty").optional(),
  model: z
    .string()
    .regex(/^\w[\w.-]*$/, "--model must be a model name such as sonnet")
    .optional(),
  bruteForceTokens: z
    .string()
    .regex(/^[1-9]\d*$/, "--brute-force-tokens must be a positive integer")
    .transform(Number)
    .optional(),
});

export function parseCliArgs(args: string[]) {
  const parsed = parseArgs({
    args,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean" },
      provider: { type: "string" },
      recording: { type: "string" },
      voice: { type: "string" },
      "voice-id": { type: "string" },
      "brute-force-tokens": { type: "string" },
      model: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const validated = cliArgsSchema.safeParse({
    positionals: parsed.positionals,
    port: parsed.values.port,
    noOpen: parsed.values["no-open"] ?? false,
    provider: parsed.values.provider,
    recording: parsed.values.recording,
    voice: parsed.values.voice,
    voiceId: parsed.values["voice-id"],
    bruteForceTokens: parsed.values["brute-force-tokens"],
    model: parsed.values.model,
  });
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("\n"));
  }
  const { provider, recording } = validated.data;
  if (provider === "fake" && !recording) {
    throw new Error("--provider fake needs --recording <file>");
  }
  if (recording && provider !== "fake") {
    throw new Error("--recording only works with --provider fake");
  }
  return {
    path: validated.data.positionals[0] ?? ".",
    port: validated.data.port ?? 0,
    noOpen: validated.data.noOpen,
    provider,
    recording,
    voice: validated.data.voice ?? "browser",
    voiceId: validated.data.voiceId ?? defaultVoiceId,
    bruteForceTokens: validated.data.bruteForceTokens,
    model: validated.data.model,
  };
}

export function speechOptions(options: ReturnType<typeof parseCliArgs>, env: NodeJS.ProcessEnv) {
  return {
    apiKey: options.voice === "elevenlabs" ? env.ELEVENLABS_API_KEY : undefined,
    voiceId: options.voiceId,
  };
}

# Architecture

## Stack

| Area | Choice |
|---|---|
| Language | TypeScript (strict), ESM |
| Runtime | Node 24 LTS (default) |
| Package manager | npm, exact versions only (default) |
| Server HTTP | `node:http` built-in, small route table, SSE for streams |
| Browser UI | Svelte 5 + Vite, plain SPA, no SvelteKit |
| Code viewer | CodeMirror 6 (read-only), `@codemirror/merge` for diffs |
| Parsing | `web-tree-sitter` with WASM grammars for TS, TSX, JS (default; no native build, so `npx` works on Windows) |
| Search | ripgrep via `@vscode/ripgrep` |
| Validation | zod at every boundary (HTTP bodies, LLM output, files read from `.tutor/`, eval cases) (default) |
| Tool protocol | `@modelcontextprotocol/sdk`, stdio server |
| File watching | `node:fs` `watch` with `recursive: true` (default) |
| Source maps | `node:module` `SourceMap` (built in) |
| Format + lint | Biome (default) |
| Types | `tsc --noEmit` + `svelte-check` (TypeScript 6; `svelte-check` does not support 7 yet) |
| Tests | Vitest (default); Playwright for browser e2e from Phase 4 (default) |
| Unused code | Knip (default) |

### Approved runtime dependencies

These may be added when the feature that needs them is built, without asking again. Anything else needs asking first.

- Phase 1: `ignore` (gitignore matching), `zod` (CLI args are validated from Phase 1)
- Phase 2: `web-tree-sitter` 0.27.1, `tree-sitter-typescript` 0.23.2 and `tree-sitter-javascript` 0.25.0 (for their `.wasm` grammars), `@vscode/ripgrep`
- Phase 3: `@modelcontextprotocol/sdk`
- Phase 4: `codemirror`, `@codemirror/*` packages; dev: `@playwright/test`
- Phase 5: none (ElevenLabs is called with built-in `fetch`, no SDK)
- Phase 8: `@anthropic-ai/sdk`, `@google/genai`
- Phase 9: `@huggingface/transformers` (Whisper), `kokoro-js` (local voice)
- Phase 10: `@ricky0123/vad-web` (Silero voice activity detection)
- Phase 11: `@codemirror/merge`

## Folder layout (default)

```
src/
  shared/        contracts (zod schemas + types) used by server and browser
  server/
    cli.ts       `miyagi` entry: args, start server, open browser, `mcp` subcommand
    http/        security checks and static files (`serve.ts`), the `/api/ask` SSE route (`ask-route.ts`)
    source/      CodeSource: LocalFolder, GitClone
    files/       file filter, path guard, secret redaction, watcher
    code/        parse cache, repo map, anchor resolver
    tools/       read_file, grep, find_symbol, git (plain functions)
    mcp/         stdio MCP server exposing the tools (`miyagi mcp <root>`, `runMcpCommand`)
    llm/         LLMProvider, providers, claude-process (spawns `claude -p`, yields stdout lines), agent loop guards, prompt builder, context manager
    teach/       .tutor store, intent, learner record, question policy, explain-back
    evals/       eval runner, code checks, judge
  web/           Svelte app: viewer, tour player, tour stack, voice
test/
  global-setup.ts  builds once per test run
  fixtures/      tiny fixture repos (incl. a prompt-injection repo); test data, not project code
    recordings/  FakeProvider and Claude stream recordings (.jsonl)
e2e/             Playwright tests (*.e2e.ts)
evals/           eval suites (JSON) and results
dist/            build output (gitignored): web/ from Vite, server/ and shared/ from tsc
THIRD_PARTY_NOTICES.md  licenses of adapted code
```

## Build and run

- Dev and tests run the TypeScript directly: `node src/server/cli.ts`.
- `npm run build` runs `vite build` (to `dist/web`) and `tsc -p tsconfig.build.json` (to `dist/server` and `dist/shared`). Node won't strip types under `node_modules`, so the published package runs `dist/server/cli.js` (`bin`), and ships only `dist`.
- The server finds `dist/web` relative to its own module location, so the same code works from `src/server` and `dist/server`.
- Anything that starts Miyagi again (the MCP server) uses `process.execPath` plus `process.argv[1]`.

## Parts and how they talk

```
Browser (Svelte)                         Node server (one process)
  code viewer + highlights      HTTP+SSE   CodeSource -> folder on disk
  tour player + tour stack   <---------->  filter + redaction + path guard
  push-to-talk / VAD          127.0.0.1    parse cache, repo map, anchors
  Whisper STT, local TTS      + token      tools (plain functions)
  selection chip                           LLMProvider -> stream of events
                                              |
                                              +-- ClaudeHeadless: spawns `claude -p`
                                              |     -> stdio MCP: `miyagi mcp <root>` (read-only tools)
                                              +-- ClaudeAPI / GeminiAPI: own agent loop, tools called directly
                                           .tutor/ store
```

- **Browser to server:** JSON over HTTP; `POST /api/ask` answers with a server-sent event stream. The server injects a random per-session token into `index.html` as `<meta name="miyagi-token" content="<64 hex chars>">`; every `/api/*` request sends it as `x-miyagi-token`. API errors are `{ "error": "<reason>" }`.
- **Server to Claude Code:** `ClaudeHeadless` spawns `claude -p` with stream JSON output, all built-in tools off, `--strict-mcp-config` with only Miyagi's MCP server, `--allowedTools` limited to `mcp__miyagi__*`, user settings and plugins not loaded, and an empty temp working folder. The MCP server is the same binary: `miyagi mcp <root>`.
- **Voice is swappable.** The browser speaks through one `Speaker` interface: `browser` (local `speechSynthesis`, default), `elevenlabs` (opt-in; the server calls ElevenLabs through `POST /api/speech` with redacted text, so the key never reaches the page), and later `kokoro`. Microphone audio never leaves the browser. See [ADR 0002](adr/0002-swappable-voice-with-elevenlabs.md).
- **Tour stack is browser state** (playback position), so pause and resume are instant.

### Routes (grow per phase)

| Route | Phase | Purpose |
|---|---|---|
| `GET /` and static assets | 1 | built Svelte page, token injected; no token needed |
| `GET /api/file?path=` | 4 | 200 `{ path, content }` (guarded, filtered, redacted), 400 `{ error }` on refusal |
| `POST /api/ask` | 3 | question (+ selection) to SSE stream of `AskEvent` |
| `POST /api/speech` | 5 | `{ text }` to `audio/mpeg` from ElevenLabs (only with `--voice elevenlabs`) |
| `POST /api/interrupt` | 10 | abort the running ask |
| `/api/tours*` | 13 | list, save, load saved tours |
| `/api/tutor/*` | 12 | profile, intent, learner record |

## Security model

- Bind to `127.0.0.1` only. Reject a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` (403), any `Origin` that isn't the server's own (403), and `/api/*` requests without the session token (401).
- Never execute anything from a repo. Read only. Git is used only for `clone --depth 1` (no submodules, no LFS smudge) and the read-only `diff`, `show`, `log`, `fetch`.
- Every path goes through the path guard: resolve, `realpath` (follows symlinks), refuse anything outside the project root, then the shared file filter.
- The shared file filter exposes `isVisible(root, relPath): Promise<boolean>` and `listVisibleFiles(root): Promise<string[]>`. The list contains sorted root-relative paths, and traversal prunes excluded directories before descending. Filtering applies nested `.gitignore` files and root `.gitattributes` generated markers, and excludes the planned lockfiles, secrets, binaries and oversized files.
- Every byte leaving the machine (tool results, brute-force content, ElevenLabs narration text) passes secret redaction.
- No network tools for the model, ever ("lethal trifecta": remove external communication). File contents are data, never instructions; tool results are wrapped in labelled untrusted blocks.
- PR review drafts comments; it never posts them.

## Data contracts (`src/shared`)

Each contract is a zod schema with its type inferred from it, one file per area (`anchor.ts`, `tour.ts`, `events.ts`, `usage.ts`, `llm-request.ts`, `tool-result.ts`, `result.ts`), and the tool input schemas are in `tool-inputs.ts`. `parseContract(schema, data)` returns a `Result` whose error lists each problem on its own line as `path: message`.

Paths everywhere (tool inputs and results, anchors, selections, routes, events) are relative to the project root with `/` separators. Only the path guard turns them into real paths.

```ts
Result<T> = { ok: true; value: T } | { ok: false; error: string }   // recoverable errors: path guard, LocalFolder

ToolResult { text: string; isError: boolean }   // every tool: (root, input) => Promise<ToolResult>, already redacted

Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null }

LLMRequest {
  system: string
  context: string               // repo map, or the brute-force repo text
  conversation: string          // earlier turns, from Phase 8
  question: string              // plus selection, current position and intent as they arrive
  root: string                  // project root, for the tools
  tools: boolean                // false for plain completions (judge, rubrics, summaries)
  model: "strong" | "small"
}

Tour {
  question: string
  steps: Step[]
  checkQuestion?: string        // the optional teaching question; the design notes called this `question` twice
}

Step {
  title: string
  anchors: Anchor[]             // 1–3 per step
  narration: { text: string; anchor?: number }[]   // written for the ear; anchor = index into anchors
}

Anchor =
  | { file: string; symbol: string }               // qualified for ambiguity, e.g. ClipService.save
  | { file: string; line: number; text: string }   // line plus that line's exact text
  // diff mode adds side: "old" | "new"

ResolvedAnchor { file: string; start: number; end: number; capped: boolean }   // 1-based inclusive lines

Selection { file: string; start: number; end: number; text: string }

SavedTour = Tour & { author, date, intent, level, baseCommit, blockHashes: string[][] }

ProviderEvent =
  | { type: "text"; text: string }
  | { type: "step"; step: Step }
  | { type: "checkQuestion"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "done"; usage: Usage }
  | { type: "error"; message: string; retryable: boolean }

AskEvent =   // what the browser receives over SSE
  | { type: "ack"; text: string }                       // templated, no LLM
  | { type: "progress"; text: string }                  // narrated exploration
  | { type: "step"; step: Step; ranges: (ResolvedAnchor | null)[] }
  | { type: "tour"; tour: Tour; ranges: (ResolvedAnchor | null)[][] }
  | { type: "error"; message: string }
  | { type: "done" }

EvalCase { question, intent, mustHighlight: string[], expectedOrder: string[], keyFacts: string[] }
```

### Providers

`LLMProvider` is `ask(request: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>` (`src/server/llm/provider.ts`); aborting the signal ends the stream. `loadFakeProvider(file)` (`fake-provider.ts`) returns a `Result` holding a provider that replays a recording: one `ProviderEvent` JSON per line, with an optional `delayMs` waited before that event. The hidden CLI flags `--provider fake --recording <file>` load it at startup and exit 1 with the problems (`line <n>: <path>: <message>`) if the recording is bad.

### Ask pipeline

`POST /api/ask` (`src/server/http/ask-route.ts`) validates `{ question, selection? }` (a question of at most 2,000 characters; 400 on a bad body or one over 100 KB), answers 409 while another ask runs, and streams `AskEvent`s as `data: <json>` SSE blocks; a closed connection aborts the provider. `askEvents` (`src/server/llm/ask.ts`) yields the `ack` phrase (rotating through `ackPhrases` in `src/shared/phrases.ts`) before anything else, builds the request with `buildRequest`, turns `tool_call` events into `progress` lines, resolves every step's anchors (`null` when unresolvable), then sends `tour` and `done`. A `text` or `error` provider event, or a thrown provider failure, ends the ask with an `error` event and no `tour`. `claudeHeadless` (`claude-headless.ts`) is the default provider; `--brute-force-tokens <n>` sets the brute-force threshold. On SIGINT or SIGTERM the server closes all connections, which aborts a running ask and kills Claude Code's process tree.

### Model output and untrusted content

- The model answers in NDJSON: one `Step` JSON object per line, then optionally one final line `{"checkQuestion": "…"}`. Providers parse each complete line into a `step` event (or a `checkQuestion` event for the final line) as it streams; a line that is valid JSON but neither becomes a non-retryable `error` event. The pipeline builds the `Tour` from the request's question, the steps and the check question. `text` events are internal: unparsed lines kept for the retry prompt. `ClaudeHeadless` (`claude-stream.ts`) reports tool calls by their plain name (`read_file`, without the `mcp__miyagi__` prefix).
- Every tool result shown to a model is wrapped by `wrapUntrusted(tool, text)` as `<untrusted_content tool="<tool>">…</untrusted_content>`, with a literal closing tag inside escaped as `<\/untrusted_content>`.

## The `.tutor/` folder (in the user's repo)

```
.tutor/
  .gitignore     ignores everything except itself and tours/
  tours/         saved tours: committed and shared
  private/       profile, intent, learner record, session record, call logs (never committed)
```

## External services

| Service | Used for | Auth |
|---|---|---|
| Claude Code CLI (`claude -p`) | default provider | the user's own Claude Code login |
| Anthropic API | `ClaudeAPI` provider (Phase 8) | `ANTHROPIC_API_KEY` |
| Gemini API | `GeminiAPI` free-tier fallback (Phase 8) | `GEMINI_API_KEY`; check limits and training terms before commercial use |
| ElevenLabs | opt-in voice, `--voice elevenlabs` (Phase 5) | `ELEVENLABS_API_KEY`; free tier needs attribution |
| GitHub (public) | `GitClone` shallow clones (Phase 6) | none |
| `gh` CLI | read PR descriptions (Phase 15), optional | the user's own `gh` login |
| Hugging Face model files | Whisper and voice model downloads in the browser, cached | none |

## Code intelligence

`parseFile(path, source)` returns the cached `web-tree-sitter` `Tree` for the extensions in `grammarsByExtension`, or `null` when there is no parser. Trees are cached by grammar and source SHA-256. See [ADR 0001](adr/0001-parse-cache-trees.md).

`readRedactedFile(root, path)` (path guard, then redaction of the whole file) is the only way the repo map, the tools and the anchor resolver read a file, and they parse the redacted text. Redaction keeps line numbers, so tree positions match the file.

`findDefinitions` in `src/server/code/symbols.ts` is the one walker for declarations and class or interface members. `find_symbol`, the repo map and `read_file` outlines use it, and `uniqueDefinition` (one match, or a not-found or ambiguous reason listing candidates) serves both `read_file({ symbol })` and symbol anchors.

`grep` never lets ripgrep see the raw files: it streams the redacted text of the selected visible files into `rg --json -` on stdin and maps stdin line numbers back to each file. A pattern can therefore only match text the model is allowed to see.

`resolveAnchor(root, anchor)` returns `Result<ResolvedAnchor>`. A line anchor takes the smallest syntax node spanning the line's trimmed text and climbs to the nearest `*_statement`, `*_declaration`, `*_definition` or `*_signature` node.

The tools share `runTool` (input validation with zod, errors as results with the root path replaced by `.`) and the `ToolResult` type in `src/shared/tool-result.ts`.

## Prompt layout and caching

```
system prompt -> repo map (or whole filtered, numbered repo in brute-force mode)
  -> [cache marker] -> conversation -> [cache marker]
  -> question (+ selection, current step/segment, learner intent)
```

- Stable content first, so the prefix stays cacheable. The repo map is deterministic for the same file hashes.
- `ClaudeAPI` sets the cache markers explicitly; `ClaudeHeadless` relies on Claude Code's own prompt caching with the same stable order.
- Brute force vs agentic search is chosen by token count at load and re-checked as the conversation grows. The threshold is a setting tuned by evals.
- `buildRequest(root, question, bruteForceTokens)` in `src/server/llm/prompt.ts` returns `{ mode, request }`: the system prompt, then the whole filtered, redacted, line-numbered repo (`=== <path> ===` headers, `12: code` lines) when it fits under the threshold (estimated as characters divided by 4; default 60,000), otherwise `buildRepoMap`. `renderPrompt(request)` joins system, context, conversation and question in that order.

## Third-party code

`ClaudeHeadless` adapts spawn, argument hardening, stream parsing and process-tree kill code from `claude-loopback` (MIT; github.com/ssaarthakk/claude-loopback). Its license is kept in `THIRD_PARTY_NOTICES.md`. The package itself is not a dependency: it exposes no library API, is Windows-only, and turns MCP off.

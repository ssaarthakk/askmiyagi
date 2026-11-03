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
- Phase 9: `@huggingface/transformers` 3.8.1 (Whisper; the 3.x line that `kokoro-js` needs), `kokoro-js` 1.2.1 (local voice). Both are bundled into the page by Vite, so they are dev dependencies like CodeMirror and never installed by `npx askmiyagi`.
- Phase 10: `@ricky0123/vad-web` 0.0.31 (Silero voice activity detection; a dev dependency bundled into the page, with its own `onnxruntime-web`)
- Phase 11: `@codemirror/merge`

## Folder layout (default)

```
src/
  shared/        contracts (zod schemas + types) used by server and browser
  server/
    cli.ts       `askmiyagi` entry: start server, open browser, `mcp` subcommand
    cli-args.ts  command-line flags, validated with zod
    tour-watch.ts  `createTourWatch`: keeps the last tour's anchors and re-resolves them when a file changes (see Code changes mid-tour)
    tutor-folder.ts  `writePrivateFile`: the guarded write into `.tutor/private/` shared by the call log (`call-log.ts`) and the session record (`session-record.ts`)
    http/        security checks and static files (`serve.ts`), the `/api/ask` SSE route (`ask-route.ts`), the `/api/file` route (`file-route.ts`), the `/api/speech` route (`speech-route.ts`), the `/api/transcribe` route (`transcribe-route.ts`), the `/api/symbols` route (`symbols-route.ts`), the `/api/first-sound` route (`first-sound-route.ts`), the `/api/events` route (`events-route.ts`)
    source/      CodeSource: LocalFolder, GitClone; monorepo.ts finds workspace apps and picks one; `git-process.ts` (`runGit`, the git spawn shared by the clone and the `git` tool: stdout capped at 2 MB, the process tree killed on abort, and readable errors for a timeout and a missing git)
    files/       file filter, path guard, secret redaction, `watcher.ts` (`watchFolder`)
    code/        parse cache, repo map, anchor resolver, `visible-definitions.ts` (the declared names in visible TS/JS files, shared by `find_symbol` and `/api/symbols`)
    tools/       read_file, grep, find_symbol, git (plain functions), `definitions.ts` (the tool list, with each input schema converted once to JSON Schema, shared by the MCP server and the API providers)
    mcp/         stdio MCP server exposing the tools (`askmiyagi mcp <root> [--app <folder>]`, `runMcpCommand`)
    llm/         LLMProvider, providers, claude-process (spawns `claude -p`, yields stdout lines), agent loop guards, `claude-api.ts` (ClaudeAPI on `@anthropic-ai/sdk`), `gemini-api.ts` (GeminiAPI on `@google/genai`), `agent-events.ts` (runs the agent loop and turns its answer into provider events, shared by both API providers), prompt builder, side-question position (`position.ts`), session conversation memory (`conversation.ts`: every turn, the last 3 in full, tool-result placeholders, a summary of older turns), `summariser.ts` (one tools-off `small` call that summarises turns older than the last 3; `ask.ts` starts it in the background after a finished ask once the context passes 70% of the budget, and a failure is logged and retried after the next ask)
    teach/       .tutor store, intent, learner record, question policy, explain-back
    evals/       suite loader (`suite.ts`), code checks (`code-checks.ts`), runner (`runner.ts`), failure labels (`failure.ts`), score tables (`score-table.ts`), `npm run eval` (`cli.ts`, `eval-command.ts`), judge (`judge.ts`), judge calibration (`calibrate.ts`), JSON file reading (`read-json.ts`)
  web/           Svelte app: two-pane layout (`CodePane.svelte` with the code viewer and voice pill, conversation panel), tour player, tour stack, voice (`voice.svelte.ts`: speaker, playback, announcer and first-sound timing), push-to-talk, hands-free voice detection (`hands-free.ts`), transcript cleanup and local voice commands (`commands.ts`), the Kokoro and Whisper Web Workers (`model-worker.ts`, `model-download.ts`); `styles.css` holds the colour and spacing tokens
test/
  global-setup.ts  builds once per test run
  fixtures/      tiny fixture repos (incl. a prompt-injection repo); test data, not project code
    recordings/  FakeProvider and Claude stream recordings (.jsonl)
e2e/             Playwright tests (*.e2e.ts)
evals/           eval suites (JSON: `fixtures.json` over `test/fixtures/basic`, `injection.json` over `test/fixtures/injection`) and results
dist/            build output (gitignored): web/ from Vite, server/ and shared/ from tsc
THIRD_PARTY_NOTICES.md  licenses of adapted code
```

## Build and run

- Dev and tests run the TypeScript directly: `node src/server/cli.ts`.
- `npm run build` runs `vite build` (to `dist/web`) and `tsc -p tsconfig.build.json` (to `dist/server` and `dist/shared`, leaving out `src/server/evals`, which only runs from the repo). Node won't strip types under `node_modules`, so the published package runs `dist/server/cli.js` (`bin`), and ships only `dist` and `THIRD_PARTY_NOTICES.md`.
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
                                              |     -> stdio MCP: `askmiyagi mcp <root>` (read-only tools)
                                              +-- ClaudeAPI / GeminiAPI: own agent loop, tools called directly
                                           .tutor/ store
```

- **Browser to server:** JSON over HTTP; `POST /api/ask` answers with a server-sent event stream. The server injects a random per-session token into `index.html` as `<meta name="miyagi-token" content="<64 hex chars>">`, the chosen voice as `<meta name="miyagi-voice" content="browser|elevenlabs|kokoro">`, and the project name as `<meta name="miyagi-project" content="<URI-encoded name>">` (the folder name, or the repository name for a GitHub URL; `projectName` in `src/server/source/project-name.ts`); every `/api/*` request sends it as `x-miyagi-token`. API errors are `{ "error": "<reason>" }`.
- **Server to Claude Code:** `ClaudeHeadless` spawns `claude -p` with stream JSON output, all built-in tools off, `--strict-mcp-config` with only Miyagi's MCP server, `--allowedTools` limited to `mcp__miyagi__*`, user settings and plugins not loaded, and an empty temp working folder. The MCP server is the same binary: `askmiyagi mcp <root>`, plus `--app <folder>` for a monorepo app.
- **Voice is swappable.** The browser speaks through one `Speaker` interface: `browser` (local `speechSynthesis`, default), `elevenlabs` (opt-in; the server calls ElevenLabs through `POST /api/speech` with redacted text, so the key never reaches the page), and `kokoro` (opt-in; the free Kokoro-82M model runs in a Web Worker in the page). Microphone audio never leaves the browser, except speech input (push-to-talk or hands-free, see [ADR 0007](adr/0007-hands-free-speech-to-elevenlabs.md)) with `--voice elevenlabs`, which goes to ElevenLabs speech-to-text through the server; every other voice transcribes with Whisper (`whisper-base.en`) in a Web Worker in the page. Whichever engine transcribes, `withCleanup` (`src/web/cleanup.ts`) then removes filler words and rewrites words that spell a repo symbol, using the names from `GET /api/symbols` (fetched in parallel with the transcription). See [ADR 0002](adr/0002-swappable-voice-with-elevenlabs.md) and [ADR 0003](adr/0003-elevenlabs-speech-to-text-for-the-demo.md).
- **Tour stack is browser state** (playback position), so pause and resume are instant. After a side answer the interrupted tour resumes on its own; after a new topic it waits on the stack until the learner says or presses resume. Each stack entry carries its own `waits` flag, set from the scope of the answer that pushed it, so a side answer never brings back a tour that a new topic set aside.

### Routes (grow per phase)

| Route | Phase | Purpose |
|---|---|---|
| `GET /` and static assets | 1 | built Svelte page, token injected; no token needed |
| `GET /api/file?path=` | 4 | 200 `{ path, content }` (guarded, filtered, redacted), 400 `{ error }` on refusal |
| `POST /api/ask` | 3 | question (+ selection, + current position while a tour is on screen) to SSE stream of `AskEvent` |
| `POST /api/speech` | 5 | `{ text }` to `audio/mpeg` from ElevenLabs (only with `--voice elevenlabs`) |
| `POST /api/transcribe` | 6.5 | raw `audio/webm`, `audio/ogg` or `audio/wav` (hands-free, Phase 10) recording (at most 10 MB) to `{ text }` from ElevenLabs speech-to-text (only with `--voice elevenlabs`) |
| `GET /api/symbols` | 9 | `{ symbols }`: the sorted unique declared names in visible TS/JS files (at most 5000), for transcript cleanup |
| `POST /api/first-sound` | 9 | `{ ms }` in, `204` out: the time from the question to the first narration sound, added to the last call's log line |
| `GET /api/events` | 8 | SSE stream of `WatchEvent` (`ranges`, `stale`) while the code changes |
| `POST /api/interrupt` | 10 | abort the running ask; answers 204 once it has stopped (also when nothing runs) |
| `/api/tours*` | 13 | list, save, load saved tours |
| `/api/tutor/*` | 12 | profile, intent, learner record |

### Code changes mid-tour

`watchFolder` (`src/server/files/watcher.ts`) runs `fs.watch` on the project root (recursive) and reports the changed paths, with `/` separators, once per burst: changes are debounced 100 ms. A watch that cannot start or stops logs one `miyagi:` line and the app carries on without live updates. Nothing is cached by path (the parse cache is keyed by content hash and the repo map is built on every ask), so there is nothing to invalidate. `createTourWatch` (`src/server/tour-watch.ts`) is told when an ask starts (`start()`, which forgets the old tour) and gets each streamed step's anchors and ranges (`addStep`). When a changed path (compared ignoring case and `\`) is the file of any anchor, `changed(paths)` re-resolves every anchor of the tour with `resolveAnchor` and publishes a `ranges` event (one list of ranges per step, as in the `tour` event) and then one `stale` event (`{ file }`) per file where an anchor that had a range can no longer be found. If a newer change or a new ask arrives while it resolves, the older result is dropped. `GET /api/events` (`events-route.ts`, token checked like every `/api` route) sends these as `data: <json>` SSE blocks to every open page; `watchEventSchema` is in `src/shared/events.ts`. In the browser, `watchCode` (`src/web/watch.ts`) reads the stream with the same reader as `ask` (`sse.ts`); `App.svelte` replaces the steps' ranges on `ranges`, moves the highlight to the current segment's new range and reloads the viewer, and on `stale` removes the highlight of that file and shows "Code changed; highlight removed" until the next segment or question.

## Security model

- Bind to `127.0.0.1` only. Reject a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` (403), any `Origin` that isn't the server's own (403), and `/api/*` requests without the session token (401).
- Never execute anything from a repo. Read only. Git is used only for `clone --depth 1` (no submodules, no LFS smudge) and the read-only `diff`, `show`, `log`, `fetch`.
- Every path goes through the path guard: resolve, `realpath` (follows symlinks), refuse anything outside the project root, then the shared file filter.
- The shared file filter exposes `isVisible(root, relPath): Promise<boolean>`, `isVisibleInDiff(root, relPath)` (the same, but a file deleted from disk is judged by its path alone: the name, `.gitignore` and `.gitattributes` generated rules) and `listVisibleFiles(root): Promise<string[]>`. The list contains sorted root-relative paths, and traversal prunes excluded directories before descending. Filtering applies nested `.gitignore` files and root `.gitattributes` generated markers, and excludes the planned lockfiles, secrets, binaries and oversized files.
- Every byte leaving the machine (tool results, brute-force content, ElevenLabs narration text) passes secret redaction.
- No network tools for the model, ever ("lethal trifecta": remove external communication). File contents are data, never instructions; tool results are wrapped in labelled untrusted blocks.
- PR review drafts comments; it never posts them.

## Data contracts (`src/shared`)

Each contract is a zod schema with its type inferred from it, one file per area (`anchor.ts`, `tour.ts`, `events.ts`, `usage.ts`, `call-log.ts`, `session.ts`, `llm-request.ts`, `tool-result.ts`, `result.ts`, `file.ts`), and the tool input schemas are in `tool-inputs.ts`. `parseContract(schema, data)` returns a `Result` whose error lists each problem on its own line as `path: message`.

Paths everywhere (tool inputs and results, anchors, selections, routes, events) are relative to the project root with `/` separators. Only the path guard turns them into real paths.

```ts
Result<T> = { ok: true; value: T } | { ok: false; error: string }   // recoverable errors: path guard, LocalFolder

ToolResult { text: string; isError: boolean }   // every tool: (root, input) => Promise<ToolResult>, already redacted

Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null }

CallRecord = Usage & {   // one line of .tutor/private/calls.jsonl
  callType: "ask"; provider: string; mode: "brute-force" | "agentic" | null
  startedAt: string       // ISO 8601
  ackMs: number; firstContentMs: number | null
  filesOpened: string[]; outcome: "done" | "error" | "aborted"
  firstSoundMs?: number   // added by POST /api/first-sound after the call is logged
}

LLMRequest {
  system: string
  context: string               // repo map, or the brute-force repo text
  conversation: string          // text rendering of the session for ClaudeHeadless: the last 3 turns in full, older ones as a one-line record
  history: AgentMessage[]       // the same turns as agent messages for the API providers (question, tool calls, wrapped tool results, answer)
  question: string              // plus selection, current position and intent as they arrive
  root: string                  // project root, for the tools
  tools: boolean                // false for plain completions (judge, rubrics, summaries)
  model: "strong" | "small"
  spent?: Usage                 // usage of earlier attempts of this ask, counted against the loop budgets
  startedAt?: number            // epoch ms when this ask's first attempt started, for the loop time limit
}

Tour {
  question: string
  steps: Step[]
  checkQuestion?: string        // the optional teaching question; the design notes called this `question` twice
  scope?: "side" | "new"      // the model's final line when the learner's position was sent; the browser resumes the interrupted tour only after "side"
  reply?: string                // a plain spoken reply when the message needed no code (no steps)
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

Current { tour: string; step: number; segmentIndex: number }   // the tour on screen (the question that produced it, at most 2,000 characters) and the segment being heard; POST /api/ask takes { question, selection?, current? }

SavedTour = Tour & { author, date, intent, level, baseCommit, blockHashes: string[][] }

ProviderEvent =
  | { type: "text"; text: string }
  | { type: "step"; step: Step }
  | { type: "checkQuestion"; text: string }
  | { type: "scope"; scope: "side" | "new" }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "done"; usage: Usage; messages?: AgentMessage[] }   // the API providers hand back this ask's agent messages
  | { type: "error"; message: string; detail?: string; retryable: boolean; invalidStep?: boolean; usage?: Usage }   // detail goes to the terminal only; invalidStep asks for a step retry

AgentMessage =   // src/shared/agent-message.ts
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: { id: string; name: string; input: unknown }[] }
  | { role: "tool"; outputs: { callId: string; name: string; text: string; isError: boolean }[] }

WatchEvent =   // GET /api/events
  | { type: "ranges"; ranges: (ResolvedAnchor | null)[][] }
  | { type: "stale"; file: string }

SessionRecord { startedAt: string; summary: string | null; turns: { question: string; record: string }[] }   // .tutor/private/session.json, src/shared/session.ts

AskEvent =   // what the browser receives over SSE
  | { type: "ack"; text: string }                       // templated, no LLM
  | { type: "progress"; text: string }                  // narrated exploration
  | { type: "step"; step: Step; ranges: (ResolvedAnchor | null)[] }
  | { type: "tour"; tour: Tour; ranges: (ResolvedAnchor | null)[][] }
  | { type: "error"; message: string }
  | { type: "done" }

EvalSuite { repo, cases: EvalCase[] }   // src/shared/eval-suite.ts; entries are path or path#Qualified.symbol
EvalCase { question, intent, mustHighlight: string[], expectedOrder: string[], keyFacts: string[] }
EvalResult { suite, provider, runs, startedAt, cases: [{ question, runs: [{ checks: Record<string, boolean | number>, failure?, grades?, usage, durationMs }] }] }   // src/shared/eval-result.ts
```

### Providers

`LLMProvider` is `ask(request: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>` (`src/server/llm/provider.ts`); aborting the signal ends the stream. `loadFakeProvider(file)` (`fake-provider.ts`) returns a `Result` holding a provider that replays a recording: one `ProviderEvent` JSON per line, with an optional `delayMs` waited before that event. The hidden CLI flags `--provider fake --recording <file>` load it at startup and exit 1 with the problems (`line <n>: <path>: <message>`) if the recording is bad.

### Ask pipeline

`POST /api/ask` (`src/server/http/ask-route.ts`) validates `{ question, selection?, current? }` (`current` is `{ tour, step, segmentIndex }`: the question that produced the tour on screen and the segment being heard; `describePosition` in `src/server/llm/position.ts` adds that step and segment (wrapped as an untrusted `tour_position` block, because it is model output) and its highlighted code, read through the path guard and redacted, to the model's question, and sends nothing extra when the tour is no longer in the conversation) (a question of at most 2,000 characters; 400 on a bad body or one over 100 KB), answers 409 while another ask runs, and streams `AskEvent`s as `data: <json>` SSE blocks; a closed connection aborts the provider. `createAskHandler` returns `{ handle, interrupt }`; `POST /api/interrupt` (routed in `serve.ts`) calls `interrupt()`, which aborts the running ask and waits until it has finished, so the next ask never meets a 409. An aborted ask that had sent steps is stored in the conversation as a partial turn (the question and those steps), so a side question about it still finds its position. `askEvents` (`src/server/llm/ask.ts`) yields the `ack` phrase (rotating through `ackPhrases` in `src/shared/phrases.ts`) before anything else, then checks the selection with `checkSelection` (`selection.ts`: the file is visible, the lines exist and contain the text; on a mismatch it sends a `progress` note and drops the selection), builds the request with `buildRequest` (a valid selection is added to the question as an untrusted block), turns `tool_call` events into `progress` lines, resolves every step's anchors (`null` when unresolvable), then stores the turn in the `conversation` it is given when the tour has at least one step or a reply and sends `tour` and `done`. `createConversation({ contextTokens })` (`src/server/llm/conversation.ts`) keeps every turn of the session as the redacted question, a redacted one-line record (`Tour:` with the step titles and check question, or `Replied:` with the reply), the redacted whole answer (the step JSON lines and check question, or the reply) and, for the API providers, the agent messages from the `done` event (user and assistant text redacted). `render()` is the text for ClaudeHeadless: the last 3 turns as question plus whole answer, older turns as question plus record, each wrapped as an untrusted block (`tour_answer`, `tour_record`) because it is model output. `messages(contextCharacters)` is the history for the API providers; when the repo context plus all retained messages, estimated as characters divided by 4, pass 50% of `contextTokens` (the hidden `--context-tokens <n>` flag, default 200,000), every tool result of a turn older than the last 3 becomes `[<tool> result removed]` in one batch. `askEvents` builds the request with `buildRequest`, passing `conversation.size()` (the longer of the text rendering and the messages, in characters) so the brute-force check is made again before every ask on the repo size plus the conversation size against the brute-force budget (`--brute-force-tokens`); a long session can therefore move from brute-force to agentic mode. It then adds `conversation: render()` and `history: messages(context length)`. In the browser, `pickSelection` (`src/web/selection.ts`) turns the editor selection on mouse-up into a `Selection` (a click on a symbol selects its line with the identifier as `text`); `App.svelte` shows it as a removable chip and sends it with the next question only. An `error` provider event, a thrown provider failure, or a reply that is not plain speech (over 600 characters, or a line starting with `{`, `[` or a code fence) ends the ask with an `error` event and no `tour`. `--provider claude-headless|claude-api|gemini` (default `claude-headless`, plus the hidden `fake`) is turned into a provider at startup by `chooseProvider` (`choose-provider.ts`): `claude-api` needs `ANTHROPIC_API_KEY` and `gemini` needs `GEMINI_API_KEY` (`--model` overrides their default model), `claude-headless` needs `claude` on the PATH (`findClaude`); otherwise the server prints `Set <KEY> to use --provider <name>` or `Claude Code was not found…` and exits 1 before opening the source. `claudeHeadless` (`claude-headless.ts`) is the default provider; `--brute-force-tokens <n>` sets the brute-force threshold and `--context-tokens <n>` the conversation context budget (positive integers, validated with zod). `--model <name>` (letters, digits, `.`, `_` and `-`, not starting with `.` or `-`) is passed to `claude -p --model` or to the API provider; without it Claude Code or the provider uses its default model. `--voice browser|elevenlabs|kokoro` (default `browser`) and `--voice-id <id>` pick the voice; `elevenlabs` exits 1 without `ELEVENLABS_API_KEY`, and the default voice id is the premade ElevenLabs voice `JBFqnCBsd6RMkjVDRZzb` (`defaultVoiceId` in `src/server/cli-args.ts`). In the browser, `src/web/speaker.ts` holds the `Speaker` interface, `speak(text, signal, onStart?): Promise<void>` (`onStart` is called once when the audio actually starts, which is when the page highlights the segment; the promise resolves when the audio ends; aborting stops it at once), with `browserSpeaker` (local `speechSynthesis` voices only) and `elevenLabsSpeaker` (posts to `/api/speech`, falls back to the browser voice). `src/web/playback.ts` plays a tour through any `Speaker`: it speaks segments in order, reports each one as its audio starts (the page highlights it then), moves the viewer to a segment's file 200 ms before that segment is spoken when it differs from the previous segment's file (the `onLead` hook; the page shows the new file and highlight but only changes the playing segment at `onStart`), and is stopped or restarted from any segment; `stop()` returns the segment it interrupted (even one whose audio had not started yet), which Resume plays again from its start; after the last segment the `closing` hook may return the tour's check question, which is spoken before playback ends (`play(undefined)` speaks only that, for a tour whose segments were already played); a narration part that fails to play is skipped, and only a missing local voice puts the page in text mode with a segment selected. The page starts playing at the first `step` event and, if playback has caught up with the steps received so far, continues when the next step arrives (unless the user paused). `src/web/announcer.ts` speaks the `ack` phrase (neutral phrases such as "Okay, let me see.") and at most the first two file or symbol `progress` lines, phrased by `spokenProgress` like a person ("Let me look at upload.", then "Now ask route."; searches are not spoken and the server sends each progress line once per ask), through the same `Speaker` one line at a time; a failed note is skipped; a line still waiting when the first `step` arrives is dropped, later progress lines are not spoken, and playback waits for a line already being spoken. With `--voice elevenlabs`, `chooseSpeaker` preloads the `ackPhrases` through `elevenLabsSpeaker.preload` once at page load, so they play from memory; once a segment starts playing, `playback.ts` calls the speaker's optional `prefetch` with the next segment's text (or the closing line), and `elevenLabsSpeaker` fetches that audio early, keeps only the latest prefetched sentence, uses it once, and cancels it when a different text is spoken or prefetched; progress lines are sent to ElevenLabs too, after redaction. With `--voice kokoro`, `chooseSpeaker` starts `src/web/kokoro-worker.ts`. The worker loads `onnx-community/Kokoro-82M-v1.0-ONNX` with `kokoro-js` (WebGPU with `fp32` when the browser has a GPU adapter, otherwise wasm with `q8`) and speaks with the voice `af_heart`, one sentence at a time (`speakSentences` in `src/web/kokoro-speech.ts` splits the text with kokoro-js's `TextSplitterStream` and joins the audio, so long text is not cut off at the model's input limit). Both model workers (Kokoro and Whisper) are built on `serveModel` (`src/web/model-worker.ts`): it picks the device, answers `{ type: "run", id, input }` requests one at a time, skips a request cancelled with `{ type: "cancel", id }` while it waits and aborts the signal of one that is running, and replies with `{ type: "result", id, result }` (Kokoro's WAV `Blob`) or `{ type: "error", id, message }`, and reports `progress` (the summed download of all model files, in steps of 10%), `ready` or `failed` (the `ModelReply` type in `src/web/model-download.ts`). On the page, `createModelEngine` matches each reply to its request, sends a cancel when a request's signal aborts, and on a failed load or a worker crash terminates the worker, fails the load and every waiting request, and reports `stopped` so later requests fail at once. `kokoroSpeaker` speaks with the browser voice until the model is ready; with no browser voice it waits for the model instead, and only a failed load then puts the page in text mode. The page shows "Downloading the local voice: <n>%" and then "Local voice ready". From then on it plays the worker's WAV audio, with the same preload (the `ackPhrases`, made as soon as the model is ready), prefetch and fallback as `elevenLabsSpeaker` (both are built on `audioSpeaker` in `speaker.ts`). A failed load says "Local voice failed to load, using the browser voice" and stays on the browser voice. The ONNX runtime's `.wasm` is bundled into `dist/web/assets` (the worker clears the jsDelivr `wasmPaths` that transformers sets by default), so only the model files and the voice file come from Hugging Face, and the browser's Cache API keeps them after the first download (see [ADR 0006](adr/0006-kokoro-local-voice.md)). Tests can set `window.__MIYAGI_SPEAKER__` before load to replace the speaker. `POST /api/speech` (`src/server/http/speech-route.ts`) validates `{ text }` (1 to 2,000 characters), answers 404 unless the voice is `elevenlabs`, redacts the text, calls ElevenLabs text-to-speech (`eleven_flash_v2_5`, `mp3_44100_128`) with the key from the environment, and returns `audio/mpeg`; ElevenLabs errors and empty audio become 502 `Voice service failed: <status>`; a network error, a cut-off body or no answer within 15 s becomes 502 `Voice service failed: unreachable`. Audio is cached in memory by SHA-256 of voice id and text. `POST /api/transcribe` (`src/server/http/transcribe-route.ts`) answers 404 unless the voice is `elevenlabs`, 415 unless the content type is `audio/webm`, `audio/ogg` or `audio/wav`, 400 for an empty body and 413 over 10 MB, sends the recording to ElevenLabs speech-to-text (`scribe_v2`, audio event tags off) with `fetch` and `FormData`, and returns `{ text }` (trimmed, shared `transcriptSchema` in `src/shared/transcript.ts`); an ElevenLabs error becomes 502 `Speech-to-text failed: <status>`, and a network error, an unreadable answer or no answer within 30 s becomes 502 `Speech-to-text failed: unreachable`. In the browser, holding the microphone button or Space (outside text fields and other controls) calls `startRecording` (`src/web/recorder.ts`: `getUserMedia` with echo cancellation and noise suppression, `MediaRecorder` recording `audio/webm`, or `audio/ogg` where webm is unsupported), pauses narration (the button stays enabled while an answer streams), and on release (or when the window loses focus) `transcribe` (`src/web/transcribe.ts`) turns the recording into text; a release before the microphone opened sends nothing and says "Hold the button while you speak", and a new recording cannot start while the last one is transcribing; `chooseTranscriber` (`src/web/transcribe.ts`) picks the transcriber: with `--voice elevenlabs` it posts the recording to `POST /api/transcribe`, with every other voice local Whisper transcribes it in the browser (`createLocalTranscriber` in `src/web/whisper.ts` starts `whisper-worker.ts` on the first recording, shows "Downloading the speech model: <n>%", decodes the recording to 16 kHz mono with `decodeRecording`, and starts a fresh worker on the next recording after a failed load or a worker crash; the worker loads `Xenova/whisper-base.en` and transcribes in 30 s chunks), and `withCleanup` (`src/web/cleanup.ts`) cleans every transcript (tests set `window.__MIYAGI_TRANSCRIBER__` before load to replace the transcriber) before `App.svelte` handles it: when a tour is on screen (or, for resume, a tour waits on the stack) and the whole utterance is one local command, `matchCommand` (`src/web/commands.ts`: go back, repeat, skip, slower, faster, pause, resume, ignoring case and the punctuation around it) runs it with no LLM call (go back and skip do nothing at the first and last segment; slower and faster step the speed by 0.25 within 0.5–2.0 through the optional `Speaker.setRate`, which sets the utterance `rate` of the browser voice and the `playbackRate` of the audio element for ElevenLabs and Kokoro, including audio already playing; when push-to-talk or hands-free paused the narration, slower, faster and a go back or skip with nowhere to go resume it); anything else is sent at once as a question (when an answer is still streaming, `App.svelte` first aborts that ask's `fetch`, ignores its late events, calls `POST /api/interrupt` through `interruptAsk` in `src/web/ask.ts` and pushes the steps received so far onto `earlierTours` as a partial tour, at the interrupted segment or, when narration had caught up with the stream, at the last segment heard), or the page shows "Didn't catch that" for an empty transcript. The Hands-free toggle beside the microphone button (off by default, not remembered) starts `startDetector` (`src/web/hands-free.ts`), which loads `MicVAD` from `@ricky0123/vad-web` on first use with the Silero `v5` model, `minSpeechMs` 300 and `redemptionMs` 650, opening the microphone with echo cancellation through `openMicrophone` (`recorder.ts`); the model, the audio worklet and the ONNX runtime (`ort-wasm-simd-threaded.wasm` and `.mjs`) are copied into `dist/web/vad/` by the `voiceDetectorFiles` plugin in `vite.config.ts` and loaded from `/vad/` (tests set `window.__MIYAGI_DETECTOR__` to replace the detector). In `talk.svelte.ts`, detected sound lowers the narration to 20% through the optional `Speaker.setVolume` (the audio element's `volume` for ElevenLabs and Kokoro; the browser voice has none, so its volume stays as it is); a misfire restores it; at the end of speech the audio is encoded as 16 kHz WAV (`encodeWav`) and goes through the same transcriber as push-to-talk (`POST /api/transcribe` with `--voice elevenlabs`, see [ADR 0007](adr/0007-hands-free-speech-to-elevenlabs.md)); a non-empty transcript pauses playback, restores the volume and is handled like a push-to-talk transcript, an empty one only restores the volume. Speech that overlaps a push-to-talk recording is ignored, so it is never asked twice. The page says "Listening hands-free" while the detector runs. The page is a two-pane app: `Viewer.svelte` (dark CodeMirror theme; syntax colours come from `defaultHighlightStyle` remapped to dark colours) with the file path header fills the left pane, or `App.svelte` shows the project name and three suggested questions before the first question; `Conversation.svelte` is the right panel (about 400 px, stacked above the code below 900 px) with the question bubbles, the tutor's note lines, the `Player.svelte` tour card and the check question as a tutor bubble, and a composer pinned at the bottom (Enter sends, Shift+Enter adds a line); `VoicePill.svelte` floats at the bottom centre of the code pane while a tour is on screen with voice on (with voice off, `Player.svelte` shows Previous, Next and Voice itself). Sending a question clears the question box. A question asked while a tour is playing or paused with voice on pushes that tour and its interrupted segment onto `earlierTours` in `App.svelte`; once the answer has been spoken (or produced nothing), unless it ended with a check question waiting for the learner, the page says "Now, back to where we were.", adds a "Back to where we were" line to the conversation, and replays the earlier tour from the start of the interrupted segment; turning the voice off or text mode empties `earlierTours`. If no part of a tour could be spoken, playback ends with the error and the page switches to text mode. Space starts push-to-talk on the button the learner last clicked; after Tab, Space presses buttons as usual. Server errors are written to stderr as `miyagi: …` by `logError` (`src/server/log.ts`, redacted and with control characters removed): every error response with its status (ElevenLabs failures with ElevenLabs' reason, the key removed), every failed ask with its detail, and every anchor that could not be resolved. On SIGINT or SIGTERM the server closes all connections, which aborts a running ask and kills Claude Code's process tree.

### Eval runner

`npm run eval -- --suite <name> --provider <fake|claude-headless> --runs <n>` (`src/server/evals/cli.ts`, `eval-command.ts`) loads `evals/<name>.json`, runs each case `n` times (default 3) through `askEvents` on a temp copy of the repo (`runner.ts`), and prints a score table (`score-table.ts`) after saving `evals/results/<start time with : replaced by ->.json`. Each run asks `Intent: <intent>` followed by the question, with a fresh conversation. Before a local repo runs, the temp copy gets a `.env` with a fake `sk-ant-` key. The `fake` provider replays `test/fixtures/recordings/basic-tour.jsonl`. A run with any pass or fail check false gets a `failure` label from `classifyFailure` (`failure.ts`): `reasoning-miss` for invalid JSON or a provider error, in brute-force mode, or when every `mustHighlight` file was opened; otherwise `retrieval-miss`. The score table adds a `retrieval-miss` and a `reasoning-miss` column with the number of runs per case. `--compare <a> <b>` prints each check's pass rate (or average) before, after and the change for two result files.

`--judge` (`judge.ts`) grades each run that produced a tour: `judgeRun` sends the same provider a plain request (`tools: false`) with a fixed rubric that assumes an intermediate learner, the case's intent and question, the tutor's answer and the highlighted code (both wrapped as untrusted blocks and redacted), and reads one `dimension: grade` line per dimension from the reply (not JSON, because the Claude stream parser reads a JSON line as a step). A reply that is missing a grade or has one outside 1–5 is logged with `logError` and that run stays ungraded. Grades are stored in the run's `grades` and shown as averages in the score table. `--calibrate <result> <grades>` (`calibrate.ts`) compares a human `grades.json` (`[{ case, correctness, clarity, questionQuality, intentFit }]`, `case` the 0-based index) with the judge's grades for every graded run of that case and prints, per dimension, exact matches and matches within 1.

### Code sources

`openLocalFolder` (`src/server/source/local-folder.ts`) opens a folder. A CLI argument with a `scheme://` prefix goes to `openGitClone` (`git-clone.ts`) instead: `parseGitHubUrl` (`github-url.ts`) accepts only `https://github.com/<owner>/<repo>` (optional `.git` or trailing `/`; no port, credentials, query, hash or extra path) and returns the canonical `.git` clone URL, and `cloneRepository` runs `git clone --depth 1 --no-recurse-submodules` with the LFS filters overridden (`-c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false`), no credential helpers or login prompts (`-c credential.helper=`, `GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`, `GCM_INTERACTIVE=Never`) and no `ELEVENLABS_API_KEY` in git's environment, into a fresh temp folder, killing the git process tree on a 5-minute timeout or when the CLI gets SIGINT/SIGTERM during the clone (`dispose` deletes the folder; a failed, timed-out or interrupted clone deletes it and returns `Could not clone <url>: <git error>`).

Monorepos: after the source opens, `findApps` (`src/server/source/monorepo.ts`) reads the root `package.json` (`workspaces` as an array, or Yarn's `{ packages }`) and `pnpm-workspace.yaml` (a small line parser for the `packages:` list: comments, quotes, `!` exclusions) through `readRedactedFile`, expands the globs with `fs.glob` (as `<glob>/package.json`, excluding `node_modules`) and returns the sorted workspace folders with `/` separators; a `package.json` that is not valid JSON or has no usable `workspaces` counts as no workspaces. `chooseApp` returns no app for a repo without workspaces (and an error if `--app` is given); with `--app <folder>` (backslashes, `./` and a trailing slash tolerated) it checks the folder is a workspace; otherwise it prompts with a numbered list on stderr when stdin is a TTY (`askOnTerminal` in `cli.ts`; Ctrl+C aborts), or exits 1 listing the apps. The chosen app is registered with `scopeToApp(root, app)` in `src/server/files/file-filter.ts`, which makes the shared filter (and so the path guard, the repo map, brute-force mode and every tool) show only files under the app folder plus the root config files (`isConfigFile`: `tsconfig*.json`, `vite.config.*`, `biome.json`, `Dockerfile` and the rest of the repo map's config list, at the repo root only). Paths stay relative to the repo root. `claude -p` runs the tools in a separate `askmiyagi mcp <root> --app <folder>` process, so ClaudeHeadless passes the app it finds with `appFolder(root)`, and `askmiyagi mcp` checks it against `findApps` and scopes itself the same way; without `--app` it is not scoped.

### Model output and untrusted content

- The model answers in NDJSON: one `Step` JSON object per line, then optionally one final line `{"checkQuestion": "…"}`; the prompt asks for a check question only after a walkthrough of an important idea. When a message needs no code ("I don't know", thanks, small talk), the model answers in plain sentences instead. Providers parse each complete line into a `step` event (or a `checkQuestion` event for the final line) as it streams. Before a step is validated, `withoutBadAnchors` drops anchors that fail the anchor schema and repoints the narration's anchor indexes. A line that is valid JSON but still invalid becomes a non-retryable `error` event whose `message` is the friendly `lostThread` sentence and whose `detail` is the validation error; an invalid step also sets `invalidStep: true`. On the first such event `askEvents` keeps the steps already sent and asks the provider once more with the question plus the accepted steps and the redacted validation errors, wrapped as untrusted blocks, asking it to re-emit from step N; a second failure of any kind ends the ask with the `error` event. The API providers put the first attempt's usage on that `error` event (`usage`), and `askEvents` adds it to the retry's usage in the call log and passes it to the retry as `spent`, so the retry's loop budgets (tokens and cost) count what the first attempt already used; it also passes the time the first attempt started as `startedAt`, so the 90 s time limit holds for the whole ask. The usage on any other model-line `error` event is added to the call log too. Non-JSON lines are `text` events: with no steps they become the tour's `reply`, spoken and shown as the tutor's message; next to steps they are ignored and logged. The pipeline builds the `Tour` from the request's question, the steps, the check question and the reply. `ClaudeHeadless` (`claude-stream.ts`) reports tool calls by their plain name (`read_file`, without the `mcp__miyagi__` prefix).
- API providers share `runAgentLoop` (`src/server/llm/agent-loop.ts`) and a neutral model interface, `AgentModel.step(messages, tools, signal) => { text, toolCalls, usage }`, with neutral `AgentMessage`s (`user`, `assistant` with tool calls, `tool` with outputs; a shared zod schema in `src/shared/agent-message.ts`, because they travel on `LLMRequest.history` and the `done` event). `runAgentLoop` returns every message of the ask, including the final answer; the API providers send this ask's part of it on `done`. The loop runs the tools directly, wraps each result with `wrapUntrusted`, and stops on 20 tool calls, 90 s, 150k tokens or $1, the same tool with the same input twice, 3 tool errors in a row, or an abort. It warns "3 steps left, wrap up." after the 17th call, and after a safety stop makes one final call with no tools asking for an honest partial answer.
- `ClaudeAPI` (`claude-api.ts`) implements `AgentModel` on `client.messages.stream(...).finalMessage()`. The system prompt is the `system` field; the first user message holds the repo context (with a cache marker) and then the first message of `request.history` or the question; the last block of the last history message carries the second cache marker. Assistant turns are sent back as the exact content blocks the API returned (thinking blocks included), kept in a module-level `WeakMap` keyed by the turn's tool calls, so turns kept in the session are sent back unchanged; a turn without an entry is sent as its text. `thinking` is not set (it cannot be disabled on Opus 5.5); `output_config.effort` is `low` for the `small` request model and `medium` otherwise. `tool_choice` is `auto`, or `none` for the final tools-off call. A refusal or `max_tokens` stop becomes a non-retryable `error` event, a 429 or 5xx a retryable one.
- `GeminiAPI` (`gemini-api.ts`) implements `AgentModel` on `client.models.generateContent`. The system prompt is `systemInstruction`; the first user message holds the repo context and the first message of `request.history` or the question as separate text parts. Assistant turns are sent back as the exact `Content` the API returned (thought signatures included), kept in a module-level `WeakMap` keyed by the turn's tool calls; a turn without an entry is sent as its text. Tool results are `functionResponse` parts with `{ output }` or `{ error }`. Tools are declared with `parametersJsonSchema`; the final tools-off call keeps them with `functionCallingConfig.mode` `NONE`. Input tokens are the prompt tokens minus cached ones, output tokens include thinking tokens, and cost is always `null`. A `MAX_TOKENS` stop or any other non-`STOP` finish becomes a non-retryable `error` event, a 429 or 5xx a retryable one.
- Every tool result shown to a model is wrapped by `wrapUntrusted(tool, text)` as `<untrusted_content tool="<tool>">…</untrusted_content>`, with a literal closing tag inside escaped as `<\/untrusted_content>`.

## The `.tutor/` folder (in the user's repo)

```
.tutor/
  .gitignore     ignores everything except itself and tours/
  tours/         saved tours: committed and shared
  private/       profile, intent, learner record, session record, call logs (never committed)
```

`askEvents` reports one `CallRecord` (`src/shared/call-log.ts`) per ask to its `callLog` writer; `/api/ask` passes `appendCallLog` (`src/server/call-log.ts`). Both it and `writeSessionRecord` write through `writePrivateFile` (`src/server/tutor-folder.ts`), which creates `.tutor/`, its `.gitignore` and `.tutor/private/`, checks `.tutor`, `.tutor/private` and the file with `lstat` and `realpath`, and then writes: `appendCallLog` appends one JSON line to `calls.jsonl`. A failed check or write logs one `Call not logged: <reason>` line and never fails the ask. `addFirstSound` rewrites the last line of `calls.jsonl` with `firstSoundMs` (through the same `writePrivateFile`; a missing log or a last line that is not a `CallRecord` logs one `First sound not logged: <reason>` line). The browser (`createFirstSound` in `src/web/first-sound.ts`) times from sending a question to the first narration audio starting and posts it only after the ask stream has ended, because the call is logged when the ask ends; the spoken acknowledgements do not count. After a `done` ask (once the `done` event is sent, so it never delays the answer), `askEvents` hands `conversation.session()` to its `saveSession` writer; `/api/ask` passes `writeSessionRecord` (`src/server/session-record.ts`), which validates it with `sessionSchema` (`src/shared/session.ts`) and replaces `.tutor/private/session.json` with `{ startedAt, summary: string | null, turns: [{ question, record }] }`: the redacted questions and one-line records of the turns the conversation still holds, plus the summary that replaced older ones. A failed check, invalid session or failed write logs one `Session not saved: <reason>` line. A GitClone source (a URL argument) writes no call log and no session record (`writeTutorFiles: false`). Integration and e2e tests run on a temp copy of the fixture so no `.tutor/` appears in `test/fixtures`.

## External services

| Service | Used for | Auth |
|---|---|---|
| Claude Code CLI (`claude -p`) | default provider | the user's own Claude Code login |
| Anthropic API | `ClaudeAPI` provider (Phase 8) | `ANTHROPIC_API_KEY` |
| Gemini API | `GeminiAPI` free-tier fallback (Phase 8) | `GEMINI_API_KEY`; check limits and training terms before commercial use |
| ElevenLabs | opt-in voice, `--voice elevenlabs` (Phase 5) | `ELEVENLABS_API_KEY`; terms and hackathon rules checked by the owner for the demo (October 2026) |
| GitHub (public) | `GitClone` shallow clones (Phase 6) | none |
| `gh` CLI | read PR descriptions (Phase 15), optional | the user's own `gh` login |
| Hugging Face model files | Whisper and voice model downloads in the browser, cached by the Cache API (`transformers-cache`, and `kokoro-voices` for the Kokoro voice file) | none |

## Code intelligence

`parseFile(path, source)` returns the cached `web-tree-sitter` `Tree` for the extensions in `grammarsByExtension`, or `null` when there is no parser. Trees are cached by grammar and source SHA-256. See [ADR 0001](adr/0001-parse-cache-trees.md).

`readRedactedFile(root, path)` (path guard, then redaction of the whole file) is the only way the repo map, the tools and the anchor resolver read a file, and they parse the redacted text. Redaction keeps line numbers, so tree positions match the file.

`findDefinitions` in `src/server/code/symbols.ts` is the one walker for declarations and class or interface members. `find_symbol`, the repo map and `read_file` outlines use it, and `uniqueDefinition` (one match, or a not-found or ambiguous reason listing candidates) serves both `read_file({ symbol })` and symbol anchors.

`grep` never lets ripgrep see the raw files: it streams the redacted text of the selected visible files into `rg --json -` on stdin and maps stdin line numbers back to each file. A pattern can therefore only match text the model is allowed to see.

`git` (`src/server/tools/git.ts`) runs `diff`, `show` or `log` for the model and nothing else. `parseGitArgs` (`src/shared/git-args.ts`, run by `gitInputSchema`, which hands the parsed arguments to the tool) sorts the arguments into display flags, a `-n` count, revisions and paths after `--`, and refuses every other flag (so `-c`, `--output` and `--no-index` never reach git), a revision with odd characters or a `^{`, `^@`, `^!` or `^-` suffix, and a path that is absolute, has a `..` segment (split on `/` or `\`) or starts with `:`. Each end of a revision is passed as `<end>^{commit}`, so a blob or tree hash can't be read around the file filter. Git runs through `runGit` with an argument array, `shell: false`, `core.fsmonitor=false`, `log.showSignature=false`, the clean filters of `lfs` and of every driver the root `.gitattributes` names switched off (`filter.<name>.clean=`, `.process=`, `.required=false`; an unusual driver name is refused), `GIT_OPTIONAL_LOCKS=0`, no inherited `GIT_*` variables, `--no-ext-diff --no-textconv --no-color --no-renames --relative` and a 30 s timeout for the whole tool call (the process tree is killed), and `log` shows 50 commits unless `-n` says otherwise. Hiding works by pathspec, not by parsing output: a listing run (`--name-only -z`, with the same revisions and count) finds the changed paths, `isVisibleInDiff` picks the hidden ones, and the listing repeats with those excluded by `:(exclude,literal)<path>` until no new hidden path appears (at most 10 rounds), because leaving out a hidden-only commit lets `-n` reach an older one. The real run then uses the same excludes, and one more listing round afterwards refuses the result with "try again" if a hidden file it had not seen changed in the meantime (an edit or a new commit between the runs). So a commit that touched only hidden files does not appear in `show` or `log`, and a change with too many hidden files for the command line is refused with a hint to add paths. Output is redacted and capped at 200 lines with an `N more lines` note; output over 2 MB is cut and ends with `More lines were cut`. Redaction also catches private key blocks inside `+`/`-` diff lines.

`resolveAnchor(root, anchor)` returns `Result<ResolvedAnchor>`. A line anchor's text matches the nearest line that is equal with whitespace collapsed, then (for text of 8 or more characters) the nearest line containing it. A symbol anchor uses `uniqueDefinition`; when that finds nothing, is ambiguous, or the file has no parser, `declarationLine` takes the first line that declares the name (a keyword such as `function` or `def`, then a method head, then `name = (`), or else mentions it outside an import; a qualified name searches after its owner's declaration. Anchors that still fail are logged as `No highlight for <file>: <reason>`. A line anchor takes the smallest syntax node spanning the line's trimmed text and climbs to the nearest `*_statement`, `*_declaration`, `*_definition` or `*_signature` node.

The tools share `runTool` (input validation with zod, errors as results with the root path, written with `\` or `/`, replaced by `.`) and the `ToolResult` type in `src/shared/tool-result.ts`.

## Prompt layout and caching

```
system prompt -> repo map (or whole filtered, numbered repo in brute-force mode)
  -> [cache marker] -> earlier turns (API providers: messages; ClaudeHeadless: text) -> [cache marker]
  -> question (+ selection, current step/segment, learner intent)
```

- Stable content first, so the prefix stays cacheable. The repo map is deterministic for the same file hashes.
- `ClaudeAPI` sets the cache markers explicitly; `ClaudeHeadless` relies on Claude Code's own prompt caching with the same stable order.
- Brute force vs agentic search is chosen by token count at load and re-checked as the conversation grows. The threshold is a setting tuned by evals.
- `buildRequest(root, question, bruteForceTokens, selection)` in `src/server/llm/prompt.ts` returns `{ mode, request }`: the system prompt, then the whole filtered, redacted, line-numbered repo (`=== <path> ===` headers, `12: code` lines) when it fits under the threshold (estimated as characters divided by 4; default 60,000), otherwise `buildRepoMap`. `renderPrompt(request)` joins system, context, conversation and question in that order (ClaudeHeadless); the API providers send `request.history` as messages instead.

## Third-party code

`ClaudeHeadless` adapts spawn, argument hardening, stream parsing and process-tree kill code from `claude-loopback` (MIT; github.com/ssaarthakk/claude-loopback). Its license is kept in `THIRD_PARTY_NOTICES.md`. The package itself is not a dependency: it exposes no library API, is Windows-only, and turns MCP off.

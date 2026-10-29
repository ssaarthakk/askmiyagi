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
    cli.ts       `askmiyagi` entry: start server, open browser, `mcp` subcommand
    cli-args.ts  command-line flags, validated with zod
    http/        security checks and static files (`serve.ts`), the `/api/ask` SSE route (`ask-route.ts`), the `/api/file` route (`file-route.ts`), the `/api/speech` route (`speech-route.ts`), the `/api/transcribe` route (`transcribe-route.ts`)
    source/      CodeSource: LocalFolder, GitClone
    files/       file filter, path guard, secret redaction, watcher
    code/        parse cache, repo map, anchor resolver
    tools/       read_file, grep, find_symbol, git (plain functions)
    mcp/         stdio MCP server exposing the tools (`askmiyagi mcp <root>`, `runMcpCommand`)
    llm/         LLMProvider, providers, claude-process (spawns `claude -p`, yields stdout lines), agent loop guards, prompt builder, session conversation memory (`conversation.ts`, last 3 turns), context manager
    teach/       .tutor store, intent, learner record, question policy, explain-back
    evals/       eval runner, code checks, judge
  web/           Svelte app: two-pane layout (code viewer, voice pill, conversation panel), tour player, tour stack, voice; `styles.css` holds the colour and spacing tokens
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
- `npm run build` runs `vite build` (to `dist/web`) and `tsc -p tsconfig.build.json` (to `dist/server` and `dist/shared`). Node won't strip types under `node_modules`, so the published package runs `dist/server/cli.js` (`bin`), and ships only `dist` and `THIRD_PARTY_NOTICES.md`.
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

- **Browser to server:** JSON over HTTP; `POST /api/ask` answers with a server-sent event stream. The server injects a random per-session token into `index.html` as `<meta name="miyagi-token" content="<64 hex chars>">`, the chosen voice as `<meta name="miyagi-voice" content="browser|elevenlabs">`, and the project name as `<meta name="miyagi-project" content="<URI-encoded name>">` (the folder name, or the repository name for a GitHub URL; `projectName` in `src/server/source/project-name.ts`); every `/api/*` request sends it as `x-miyagi-token`. API errors are `{ "error": "<reason>" }`.
- **Server to Claude Code:** `ClaudeHeadless` spawns `claude -p` with stream JSON output, all built-in tools off, `--strict-mcp-config` with only Miyagi's MCP server, `--allowedTools` limited to `mcp__miyagi__*`, user settings and plugins not loaded, and an empty temp working folder. The MCP server is the same binary: `askmiyagi mcp <root>`.
- **Voice is swappable.** The browser speaks through one `Speaker` interface: `browser` (local `speechSynthesis`, default), `elevenlabs` (opt-in; the server calls ElevenLabs through `POST /api/speech` with redacted text, so the key never reaches the page), and later `kokoro`. Microphone audio never leaves the browser, except push-to-talk with `--voice elevenlabs`, which goes to ElevenLabs speech-to-text through the server. See [ADR 0002](adr/0002-swappable-voice-with-elevenlabs.md) and [ADR 0003](adr/0003-elevenlabs-speech-to-text-for-the-demo.md).
- **Tour stack is browser state** (playback position), so pause and resume are instant.

### Routes (grow per phase)

| Route | Phase | Purpose |
|---|---|---|
| `GET /` and static assets | 1 | built Svelte page, token injected; no token needed |
| `GET /api/file?path=` | 4 | 200 `{ path, content }` (guarded, filtered, redacted), 400 `{ error }` on refusal |
| `POST /api/ask` | 3 | question (+ selection) to SSE stream of `AskEvent` |
| `POST /api/speech` | 5 | `{ text }` to `audio/mpeg` from ElevenLabs (only with `--voice elevenlabs`) |
| `POST /api/transcribe` | 6.5 | raw `audio/webm` or `audio/ogg` recording (at most 10 MB) to `{ text }` from ElevenLabs speech-to-text (only with `--voice elevenlabs`) |
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

Each contract is a zod schema with its type inferred from it, one file per area (`anchor.ts`, `tour.ts`, `events.ts`, `usage.ts`, `llm-request.ts`, `tool-result.ts`, `result.ts`, `file.ts`), and the tool input schemas are in `tool-inputs.ts`. `parseContract(schema, data)` returns a `Result` whose error lists each problem on its own line as `path: message`.

Paths everywhere (tool inputs and results, anchors, selections, routes, events) are relative to the project root with `/` separators. Only the path guard turns them into real paths.

```ts
Result<T> = { ok: true; value: T } | { ok: false; error: string }   // recoverable errors: path guard, LocalFolder

ToolResult { text: string; isError: boolean }   // every tool: (root, input) => Promise<ToolResult>, already redacted

Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null }

LLMRequest {
  system: string
  context: string               // repo map, or the brute-force repo text
  conversation: string          // the last 3 turns (question + one-line tour record) from the session memory; the Phase 8 context manager replaces it
  question: string              // plus selection, current position and intent as they arrive
  root: string                  // project root, for the tools
  tools: boolean                // false for plain completions (judge, rubrics, summaries)
  model: "strong" | "small"
}

Tour {
  question: string
  steps: Step[]
  checkQuestion?: string        // the optional teaching question; the design notes called this `question` twice
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

SavedTour = Tour & { author, date, intent, level, baseCommit, blockHashes: string[][] }

ProviderEvent =
  | { type: "text"; text: string }
  | { type: "step"; step: Step }
  | { type: "checkQuestion"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "done"; usage: Usage }
  | { type: "error"; message: string; detail?: string; retryable: boolean }   // detail goes to the terminal only

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

`POST /api/ask` (`src/server/http/ask-route.ts`) validates `{ question, selection? }` (a question of at most 2,000 characters; 400 on a bad body or one over 100 KB), answers 409 while another ask runs, and streams `AskEvent`s as `data: <json>` SSE blocks; a closed connection aborts the provider. `askEvents` (`src/server/llm/ask.ts`) yields the `ack` phrase (rotating through `ackPhrases` in `src/shared/phrases.ts`) before anything else, then checks the selection with `checkSelection` (`selection.ts`: the file is visible, the lines exist and contain the text; on a mismatch it sends a `progress` note and drops the selection), builds the request with `buildRequest` (a valid selection is added to the question as an untrusted block), turns `tool_call` events into `progress` lines, resolves every step's anchors (`null` when unresolvable), then stores the turn in the `conversation` it is given when the tour has at least one step or a reply (`src/server/llm/conversation.ts`: the redacted question plus a redacted one-line record, `Tour:` with the step titles and check question or `Replied:` with the reply, wrapped as an untrusted `tour_record` block because it is model output; last 3 turns, rendered into the next request) and sends `tour` and `done`. In the browser, `pickSelection` (`src/web/selection.ts`) turns the editor selection on mouse-up into a `Selection` (a click on a symbol selects its line with the identifier as `text`); `App.svelte` shows it as a removable chip and sends it with the next question only. An `error` provider event, a thrown provider failure, or a reply that is not plain speech (over 600 characters, or a line starting with `{`, `[` or a code fence) ends the ask with an `error` event and no `tour`. `claudeHeadless` (`claude-headless.ts`) is the default provider; `--brute-force-tokens <n>` sets the brute-force threshold. `--model <name>` (letters, digits, `.`, `_` and `-`, not starting with `.` or `-`) is passed to `claude -p --model`; without it Claude Code uses its default model. `--voice browser|elevenlabs` (default `browser`) and `--voice-id <id>` pick the voice; `elevenlabs` exits 1 without `ELEVENLABS_API_KEY`, and the default voice id is the premade ElevenLabs voice `JBFqnCBsd6RMkjVDRZzb` (`defaultVoiceId` in `src/server/cli-args.ts`). In the browser, `src/web/speaker.ts` holds the `Speaker` interface, `speak(text, signal, onStart?): Promise<void>` (`onStart` is called once when the audio actually starts, which is when the page highlights the segment; the promise resolves when the audio ends; aborting stops it at once), with `browserSpeaker` (local `speechSynthesis` voices only) and `elevenLabsSpeaker` (posts to `/api/speech`, falls back to the browser voice). `src/web/playback.ts` plays a tour through any `Speaker`: it speaks segments in order, reports each one as its audio starts (the page highlights it then), and is stopped or restarted from any segment; `stop()` returns the segment it interrupted (even one whose audio had not started yet), which Resume plays again from its start; after the last segment the `closing` hook may return the tour's check question, which is spoken before playback ends (`play(undefined)` speaks only that, for a tour whose segments were already played); a narration part that fails to play is skipped, and only a missing local voice puts the page in text mode with a segment selected. The page starts playing at the first `step` event and, if playback has caught up with the steps received so far, continues when the next step arrives (unless the user paused). `src/web/announcer.ts` speaks the `ack` phrase (neutral phrases such as "Okay, let me see.") and at most the first two file or symbol `progress` lines, phrased by `spokenProgress` like a person ("Let me look at upload.", then "Now ask route."; searches are not spoken and the server sends each progress line once per ask), through the same `Speaker` one line at a time; a failed note is skipped; a line still waiting when the first `step` arrives is dropped, later progress lines are not spoken, and playback waits for a line already being spoken. With `--voice elevenlabs`, `chooseSpeaker` preloads the `ackPhrases` through `elevenLabsSpeaker.preload` once at page load, so they play from memory; once a segment starts playing, `playback.ts` calls the speaker's optional `prefetch` with the next segment's text (or the closing line), and `elevenLabsSpeaker` fetches that audio early, keeps only the latest prefetched sentence, and uses it once; progress lines are sent to ElevenLabs too, after redaction. Tests can set `window.__MIYAGI_SPEAKER__` before load to replace the speaker. `POST /api/speech` (`src/server/http/speech-route.ts`) validates `{ text }` (1 to 2,000 characters), answers 404 unless the voice is `elevenlabs`, redacts the text, calls ElevenLabs text-to-speech (`eleven_flash_v2_5`, `mp3_44100_128`) with the key from the environment, and returns `audio/mpeg`; ElevenLabs errors and empty audio become 502 `Voice service failed: <status>`; a network error, a cut-off body or no answer within 15 s becomes 502 `Voice service failed: unreachable`. Audio is cached in memory by SHA-256 of voice id and text. `POST /api/transcribe` (`src/server/http/transcribe-route.ts`) answers 404 unless the voice is `elevenlabs`, 415 unless the content type is `audio/webm` or `audio/ogg`, 400 for an empty body and 413 over 10 MB, sends the recording to ElevenLabs speech-to-text (`scribe_v2`, audio event tags off) with `fetch` and `FormData`, and returns `{ text }` (trimmed, shared `transcriptSchema` in `src/shared/transcript.ts`); an ElevenLabs error becomes 502 `Speech-to-text failed: <status>`, and a network error, an unreadable answer or no answer within 30 s becomes 502 `Speech-to-text failed: unreachable`. In the browser (only with `--voice elevenlabs`), holding the microphone button or Space (outside text fields and other controls) calls `startRecording` (`src/web/recorder.ts`: `getUserMedia` with echo cancellation and noise suppression, `MediaRecorder` recording `audio/webm`, or `audio/ogg` where webm is unsupported), pauses narration, and on release (or when the window loses focus) `transcribe` (`src/web/transcribe.ts`) posts the recording; a release before the microphone opened sends nothing and says "Hold the button while you speak", and a new recording cannot start while the last one is transcribing; `App.svelte` sends the text at once as a question, or shows "Didn't catch that" for an empty transcript. The page is a two-pane app: `Viewer.svelte` (dark CodeMirror theme; syntax colours come from `defaultHighlightStyle` remapped to dark colours) with the file path header fills the left pane, or `App.svelte` shows the project name and three suggested questions before the first question; `Conversation.svelte` is the right panel (about 400 px, stacked above the code below 900 px) with the question bubbles, the tutor's note lines, the `Player.svelte` tour card and the check question as a tutor bubble, and a composer pinned at the bottom (Enter sends, Shift+Enter adds a line); `VoicePill.svelte` floats at the bottom centre of the code pane while a tour is on screen with voice on (with voice off, `Player.svelte` shows Previous, Next and Voice itself). Sending a question clears the question box. A question asked while a tour is playing or paused with voice on pushes that tour and its interrupted segment onto `earlierTours` in `App.svelte`; once the answer has been spoken (or produced nothing), unless it ended with a check question waiting for the learner, the page says "Now, back to where we were.", adds a "Back to where we were" line to the conversation, and replays the earlier tour from the start of the interrupted segment; turning the voice off or text mode empties `earlierTours`. If no part of a tour could be spoken, playback ends with the error and the page switches to text mode. Space starts push-to-talk on the button the learner last clicked; after Tab, Space presses buttons as usual. Server errors are written to stderr as `miyagi: …` by `logError` (`src/server/log.ts`, redacted and with control characters removed): every error response with its status (ElevenLabs failures with ElevenLabs' reason, the key removed), every failed ask with its detail, and every anchor that could not be resolved. On SIGINT or SIGTERM the server closes all connections, which aborts a running ask and kills Claude Code's process tree.

### Code sources

`openLocalFolder` (`src/server/source/local-folder.ts`) opens a folder. A CLI argument with a `scheme://` prefix goes to `openGitClone` (`git-clone.ts`) instead: `parseGitHubUrl` (`github-url.ts`) accepts only `https://github.com/<owner>/<repo>` (optional `.git` or trailing `/`; no port, credentials, query, hash or extra path) and returns the canonical `.git` clone URL, and `cloneRepository` runs `git clone --depth 1 --no-recurse-submodules` with the LFS filters overridden (`-c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false`), no credential helpers or login prompts (`-c credential.helper=`, `GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`, `GCM_INTERACTIVE=Never`) and no `ELEVENLABS_API_KEY` in git's environment, into a fresh temp folder, killing the git process tree on a 5-minute timeout or when the CLI gets SIGINT/SIGTERM during the clone (`dispose` deletes the folder; a failed, timed-out or interrupted clone deletes it and returns `Could not clone <url>: <git error>`).

### Model output and untrusted content

- The model answers in NDJSON: one `Step` JSON object per line, then optionally one final line `{"checkQuestion": "…"}`; the prompt asks for a check question only after a walkthrough of an important idea. When a message needs no code ("I don't know", thanks, small talk), the model answers in plain sentences instead. Providers parse each complete line into a `step` event (or a `checkQuestion` event for the final line) as it streams. Before a step is validated, `withoutBadAnchors` drops anchors that fail the anchor schema and repoints the narration's anchor indexes. A line that is valid JSON but still invalid becomes a non-retryable `error` event whose `message` is the friendly `lostThread` sentence and whose `detail` is the validation error. Non-JSON lines are `text` events: with no steps they become the tour's `reply`, spoken and shown as the tutor's message; next to steps they are ignored and logged. The pipeline builds the `Tour` from the request's question, the steps, the check question and the reply. `ClaudeHeadless` (`claude-stream.ts`) reports tool calls by their plain name (`read_file`, without the `mcp__miyagi__` prefix).
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
| ElevenLabs | opt-in voice, `--voice elevenlabs` (Phase 5) | `ELEVENLABS_API_KEY`; terms and hackathon rules checked by the owner for the demo (October 2026) |
| GitHub (public) | `GitClone` shallow clones (Phase 6) | none |
| `gh` CLI | read PR descriptions (Phase 15), optional | the user's own `gh` login |
| Hugging Face model files | Whisper and voice model downloads in the browser, cached | none |

## Code intelligence

`parseFile(path, source)` returns the cached `web-tree-sitter` `Tree` for the extensions in `grammarsByExtension`, or `null` when there is no parser. Trees are cached by grammar and source SHA-256. See [ADR 0001](adr/0001-parse-cache-trees.md).

`readRedactedFile(root, path)` (path guard, then redaction of the whole file) is the only way the repo map, the tools and the anchor resolver read a file, and they parse the redacted text. Redaction keeps line numbers, so tree positions match the file.

`findDefinitions` in `src/server/code/symbols.ts` is the one walker for declarations and class or interface members. `find_symbol`, the repo map and `read_file` outlines use it, and `uniqueDefinition` (one match, or a not-found or ambiguous reason listing candidates) serves both `read_file({ symbol })` and symbol anchors.

`grep` never lets ripgrep see the raw files: it streams the redacted text of the selected visible files into `rg --json -` on stdin and maps stdin line numbers back to each file. A pattern can therefore only match text the model is allowed to see.

`resolveAnchor(root, anchor)` returns `Result<ResolvedAnchor>`. A line anchor's text matches the nearest line that is equal with whitespace collapsed, then (for text of 8 or more characters) the nearest line containing it. A symbol anchor uses `uniqueDefinition`; when that finds nothing, is ambiguous, or the file has no parser, `declarationLine` takes the first line that declares the name (a keyword such as `function` or `def`, then a method head, then `name = (`), or else mentions it outside an import; a qualified name searches after its owner's declaration. Anchors that still fail are logged as `No highlight for <file>: <reason>`. A line anchor takes the smallest syntax node spanning the line's trimmed text and climbs to the nearest `*_statement`, `*_declaration`, `*_definition` or `*_signature` node.

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
- `buildRequest(root, question, bruteForceTokens, selection, conversation)` in `src/server/llm/prompt.ts` returns `{ mode, request }`: the system prompt, then the whole filtered, redacted, line-numbered repo (`=== <path> ===` headers, `12: code` lines) when it fits under the threshold (estimated as characters divided by 4; default 60,000), otherwise `buildRepoMap`. `renderPrompt(request)` joins system, context, conversation and question in that order.

## Third-party code

`ClaudeHeadless` adapts spawn, argument hardening, stream parsing and process-tree kill code from `claude-loopback` (MIT; github.com/ssaarthakk/claude-loopback). Its license is kept in `THIRD_PARTY_NOTICES.md`. The package itself is not a dependency: it exposes no library API, is Windows-only, and turns MCP off.

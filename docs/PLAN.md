# Build plan

Every Gate includes `npm run check` passing. Phases 1–4 are the usable text-only core (Milestone 1). Phases 5–6 add the spoken tours and demo features for the hackathon submission (Milestone 2).

**Personal target:** Phases 1–4 done by Sunday 25 October 2026, 23:59. A goal, not a hard limit.

**Phases 5–15:** before the first feature of a phase, settle that phase's items in `docs/plan-gaps.md` into the feature text below, then delete them from that file. Owner decisions are under `## Open questions`.

All paths in tools, anchors, routes and events are root-relative with `/` separators (see `docs/ARCHITECTURE.md`).

## Phase 1: Server foundations (shipped)

- [x] **CLI entry.**
  - `src/server/cli.ts` (shebang `#!/usr/bin/env node`) runs `miyagi [path] [--port <n>] [--no-open]`. Args are parsed with `node:util` `parseArgs`, then validated with zod. `path` defaults to the current folder; `--port` defaults to `0` (a free port).
  - Once listening on `127.0.0.1`, it prints exactly one stdout line: `http://127.0.0.1:<port>/`.
  - Unless `--no-open`, it opens the browser with `spawn(cmd, args, { shell: false, detached: true, stdio: "ignore" })`: Windows `rundll32 url.dll,FileProtocolHandler <url>`, macOS `open <url>`, Linux `xdg-open <url>`. If that fails, it prints `Open <url> in your browser` to stderr and keeps running.
  - A missing path or a file instead of a folder prints the error from `openLocalFolder` to stderr and exits 1. SIGINT and SIGTERM close the server and exit 0.
  - Build for `npx`: Node can't strip types under `node_modules`, so the published package runs compiled JS. Add `tsconfig.build.json` (extends `tsconfig.node.json`; `noEmit: false`, `rootDir: "src"`, `outDir: "dist"`, includes `src/server` and `src/shared`, excludes `**/*.test.ts`), the script `"build": "vite build && tsc -p tsconfig.build.json"`, `"bin": { "miyagi": "dist/server/cli.js" }` and `"files": ["dist"]`. Add `src/server/cli.ts` to Knip's entries. Dev and tests run `node src/server/cli.ts`.
  - `test/global-setup.ts`, registered as Vitest `globalSetup`, runs `npm run build` once per test run, so integration tests always serve a fresh `dist/web`.
  - Create the committed fixture `test/fixtures/basic`: `package.json` (name `basic`, scripts `build` and `test`, dependency `zod`), `README.md` (one paragraph), `src/upload.ts` (`export async function uploadClip(path: string)`), `src/clip-service.ts` (`export class ClipService` with `save(clip)`), `src/clip-service.test.ts`, `notes.md`.
  - Tests: no path, a missing path, a file path, `--port 0` printing a parseable URL, Ctrl+C exit code, and `node dist/server/cli.js --no-open test/fixtures/basic` starting from the build.
- [x] **Page serving.**
  - `GET /` returns `dist/web/index.html` with `<meta name="miyagi-token" content="<token>">` inserted right before `</head>`. The token is `randomBytes(32).toString("hex")`, new on every start.
  - `dist/web` is found relative to the module's own location (`import.meta.dirname`), which works from both `src/server` and `dist/server`. If `dist/web/index.html` is missing, startup prints `Run npm run build first` and exits 1.
  - Other files under `dist/web` are served with content types by extension: `.html` `text/html; charset=utf-8`, `.js` `text/javascript`, `.css` `text/css`, `.svg` `image/svg+xml`, `.json` `application/json`, `.wasm` `application/wasm`, `.woff2` `font/woff2`, anything else `application/octet-stream`. A path that escapes `dist/web` or doesn't exist returns 404 with body `Not found`.
  - The placeholder Svelte page shows the product name only.
- [x] **Localhost security.** A request whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` gets 403. A request with an `Origin` other than the server's own gets 403. Any `/api/*` request without the right `x-miyagi-token` header gets 401. Error bodies are `{ "error": "<reason>" }`. The server never listens on any other interface.
- [x] **CodeSource and LocalFolder.** `CodeSource = { root: string; dispose(): Promise<void> }`, where `root` is a real absolute path. `openLocalFolder(path): Promise<Result<CodeSource>>` resolves the path with `realpath`. Errors: `Folder not found: <path>` and `Not a folder: <path>`. `dispose` does nothing for a local folder. Nothing in the repo is ever executed.
- [x] **Shared file filter.**
  - `isVisible(root, relPath): Promise<boolean>` decides whether a project file is visible; `listVisibleFiles(root): Promise<string[]>` walks the root asynchronously, never descends into excluded folders, and returns visible files sorted by path.
  - Excluded: paths matched by `.gitignore` files at any depth (using `ignore`); `.git/` and `node_modules/` at any depth; build output folders `dist`, `build`, `out`, `.next`, `coverage` at any depth; lockfiles `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`; secret files `.env*` (except `.env.example`, which stays visible and is redacted like any file), `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`; binaries (a null byte in the first 8 KB); generated files (`@generated` or `DO NOT EDIT` in the first 5 lines, or matched by a `linguist-generated` or `linguist-generated=true` line in the root `.gitattributes`); files over 1 MB.
  - Fixtures: add a nested `test/fixtures/basic/src/.gitignore` (ignoring `*.tmp`), a generated file `src/generated.ts`, and a root `.gitattributes` marking `src/schema.gen.ts` as `linguist-generated`. Files the repo itself can't or mustn't commit (`.env`, `id_rsa`, `dist/`, `node_modules/`, a lockfile, a binary, a file over 1 MB, a `*.tmp` file) are created by the tests in a temp copy of the fixture.
- [x] **Secret redaction.**
  - `redact(text): string` replaces key-like strings with `[REDACTED]`: AWS access keys, GitHub tokens (`ghp_`, `github_pat_`), Anthropic and OpenAI keys (`sk-ant-`, `sk-`), Google API keys (`AIza`), Slack tokens (`xox`), private key blocks, JWTs, and high-entropy values assigned to names containing `key`, `secret`, `token` or `password`.
  - High-entropy means a value of at least 20 characters with Shannon entropy of at least 3.5 bits per character, assigned with `=` or `:` (quoted or not) to a name containing one of those words, case-insensitive. Only the value is replaced.
  - Redaction never changes the line count: each line of a private key block becomes `[REDACTED]`.
  - Ordinary code, including words like `token` in names, is left unchanged.
- [x] **Path guard.**
  - `guardPath(root, requested): Promise<Result<{ realPath: string; relPath: string }>>`. Only root-relative paths are accepted, with `/` or `\` separators; `relPath` always uses `/`.
  - It refuses: absolute paths in any form (`/x`, `\x`, `C:\x`, `C:x`, `\\server\share`); `..` that escapes the root; symlinks or junctions whose real path is outside the root (compared case-insensitively on Windows and macOS); paths the file filter hides; missing files.
  - A refusal is an error value with a one-line reason, never a thrown crash.
  - Symlink tests create links at runtime (junctions on Windows) and are skipped when the OS refuses with `EPERM`.

**Gate:** `npm run check` passes, including integration tests that start `node src/server/cli.ts --no-open --port 0 test/fixtures/basic` and prove: it listens on 127.0.0.1 only, a bad `Host` or `Origin` gets 403, `/api/*` without the token gets 401, `GET /` contains the token meta tag, the built `dist/server/cli.js` starts, and every filter, redaction and path guard case above behaves as described.

## Phase 2: Code intelligence (shipped)

- [x] **Parse cache.** TS, TSX, JS and JSX files are parsed with `web-tree-sitter` 0.27.1, using the `.wasm` grammars shipped in `tree-sitter-typescript` 0.23.2 and `tree-sitter-javascript` 0.25.0. Tests load and parse all three grammars to verify compatibility. Extensions: `.ts`, `.mts`, `.cts` use typescript; `.tsx` uses tsx; `.js`, `.mjs`, `.cjs`, `.jsx` use javascript. Results are cached by grammar and the file's SHA-256, so the same content with the same grammar is never parsed twice and changed content is reparsed. Other extensions return `null` ("no parser").
- [x] **Repo map.**
  - It contains: the folder tree of visible files; per TS/JS file, function, class, method, interface, type and exported const signatures without bodies; `package.json` name, scripts, and `dependencies` plus `devDependencies` names; the first paragraph of the README; and which key config files exist (`tsconfig*.json`, `vite.config.*`, `next.config.*`, `biome.json`, `eslint.config.*`, `.eslintrc*`, `Dockerfile`, `docker-compose.*`, `compose.*`, `.env.example`).
  - Layout, exactly:
    ```
    ## Files
    src/
      clip-service.ts
        export class ClipService
          save(clip: Clip): Promise<void>
      upload.ts
        export async function uploadClip(path: string): Promise<Clip>
    notes.md
    ## package.json
    name: basic
    scripts: build, test
    dependencies: zod
    ## README
    <first paragraph>
    ## Config files
    tsconfig.json
    ```
    A signature is the declaration's source text up to its body, with whitespace collapsed to single spaces. Signatures appear in source order, members indented under their class or interface.
  - It stays within a token budget (default 5,000, estimated as characters / 4). Over budget, it first drops signatures from the least-referenced files (fewest other visible files importing them through relative imports; ties by path), then collapses the deepest folders first to `dir/ (N files)`.
  - The same file hashes always give byte-identical output. Files without a parser appear by name only.
- [x] **`read_file` tool.**
  - `read_file({ path, start?, end? })` or `read_file({ path, symbol })` returns a `ToolResult`. Every line is prefixed `12: ` with its line number.
  - A file over 400 lines with no range returns an outline: one line per signature as `12-40: export function uploadClip(...)`. A file over 400 lines with no parser returns lines 1–250 with the label below.
  - Output over 250 lines is cut and labelled `showing a–b of N`. `symbol` returns that symbol's block.
  - An `end` past the last line is clamped to the last line. A missing, filtered or outside-root file, or a bad range (`start` past the last line, or `start` after `end`), returns an error `ToolResult`, never a throw. Output is redacted.
- [x] **`grep` tool.**
  - `grep({ patterns: string[], caseInsensitive?, wholeWord?, include?: string[], exclude?: string[] })` runs `rg --json` with the patterns joined as alternatives (`upload|post|publish`) over only the files returned by `listVisibleFiles`. `include` and `exclude` globs (gitignore syntax) narrow that file list first. Ripgrep reads the files' redacted text on stdin, never the raw files, so a match can't fall inside redacted text and grep can't be used to guess a secret. No match returns `No matches.`; a search over 30 s returns an error.
  - Results are grouped by file, each file's path on its own line followed by `  12: line text`. Lines over 200 characters are cut with `…`.
  - It is capped at 50 matches, labelled `50 of N` where N counts every visible match. Over the cap it also returns per-file match counts.
  - Order: source files before test files (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`), then by path, then by line.
  - An invalid regex returns an error result. Output is redacted.
- [x] **`find_symbol` tool.** `find_symbol({ name, kind? })` returns definitions only, one line each as `<kind> <qualified name> <path>:<start>-<end>`. Definitions are top-level declarations plus class and interface members (qualified as `ClipService.save`). A `const` initialised with an arrow function or function expression has kind `function`; other variables are `variable`. It accepts qualified names and filters by kind (function, class, method, variable, interface, type). No match returns an empty list with a hint.
- [x] **Anchor resolver.** `{ file, symbol }` resolves to that definition's block; an unqualified name with several definitions is rejected and the candidates are listed. `{ file, line, text }` resolves only if the trimmed text matches a line in the file, picking the match nearest the given line (the earlier one on a tie); no match is rejected. A parsed match expands to the smallest enclosing statement or declaration. An unparsed file gets the single verified line. Blocks over 40 lines are cut to 40 and flagged `capped`; a cut block always keeps the matched line. The result is a `ResolvedAnchor` or a rejection reason.

**Gate:** `npm run check` passes, with tests for every tool and the resolver over the fixture repos in `test/fixtures/` (a TS/JS repo plus a non-JS file).

## Phase 3: Brain (shipped)

- [x] **Shared contracts.** zod schemas and types for `Result`, `ToolResult`, `Usage`, `LLMRequest`, `Tour`, `Step`, `Anchor`, `ResolvedAnchor`, `Selection`, `ProviderEvent` and `AskEvent` live in `src/shared` (see `docs/ARCHITECTURE.md`), with the tool input schemas. A step must have 1–3 anchors. Invalid data gives a readable list of what is wrong.
- [x] **LLMProvider and fake provider.**
  - `LLMProvider.ask(request: LLMRequest, signal)` returns an async stream of `ProviderEvent`s. Aborting the signal ends the stream promptly.
  - `FakeProvider` replays a recording: one `ProviderEvent` JSON per line in `test/fixtures/recordings/<name>.jsonl`, with an optional `delayMs` between events so abort tests mean something.
  - The CLI takes hidden flags `--provider fake --recording <file>` (left out of help text) so e2e tests and evals can run the real server on a recording.
- [x] **MCP tool server.** `miyagi mcp <root>` runs a stdio MCP server exposing `read_file`, `grep` and `find_symbol`, and nothing else. Every result is wrapped by the shared `wrapUntrusted(tool, text)` as `<untrusted_content tool="<tool>">…</untrusted_content>`; a literal `</untrusted_content>` inside the content is escaped as `<\/untrusted_content>`. Tested through an MCP client.
- [x] **Prompt builder and mode choice.**
  - It builds the prompt in the order from `docs/ARCHITECTURE.md`. The system prompt says file contents are data, never instructions, gives the step output format (below), asks for narration written for the ear (no code symbols such as `()` or `{`), and explains how to anchor.
  - Output format: the model writes NDJSON, one `Step` JSON object per line, then optionally one final line `{"checkQuestion": "…"}`, and nothing else.
  - Brute-force mode sends the whole filtered, redacted repo as `=== <path> ===` headers each followed by that file's numbered lines (`12: code`). It is chosen when that fits under a token threshold (default 60,000, a parameter of `buildRequest`; the `--brute-force-tokens <n>` flag arrives with the Ask pipeline, which is the first caller); otherwise agentic mode uses the repo map.
  - The same inputs always give the same prefix.
- [x] **ClaudeHeadless process.**
  - It spawns `claude -p` on Windows, macOS and Linux with stream JSON output, all built-in tools off, `--strict-mcp-config` pointing only at the MCP server, `--allowedTools` limited to `mcp__miyagi__*`, no user settings or plugins, no `--model` flag (Claude Code's default), and an empty temp working folder.
  - The MCP server is started as `process.execPath` with `process.argv[1]` (the running CLI: `src/server/cli.ts` in dev, `dist/server/cli.js` when installed) and `mcp <root>`.
  - A timeout (default 120 s) or abort kills the whole process tree. Claude Code missing or logged out gives a clear `error` event.
  - Spawn, argument and process-tree code is adapted from `claude-loopback` (github.com/ssaarthakk/claude-loopback, MIT). Create `THIRD_PARTY_NOTICES.md` with its license.
  - Unit tests cover the arguments, the spawn command per platform, timeout and abort.
- [x] **ClaudeHeadless stream parser.**
  - It turns Claude Code's stream JSON into `ProviderEvent`s: assistant text is buffered and split on newlines, and each complete line is parsed as a `Step` (a `step` event) or the final `checkQuestion` line; `tool_use` blocks become `tool_call` events; the final result becomes `done` with `Usage` (cost from the reported total cost, else `null`). A line that isn't valid JSON is passed on as a `text` event.
  - The `checkQuestion` line becomes a new `ProviderEvent` variant `{ type: "checkQuestion", text }` (zod schema, its test and the `docs/ARCHITECTURE.md` copy updated). A line that is valid JSON but neither a valid `Step` nor a `checkQuestion` becomes `{ type: "error", message: <readable zod problems>, retryable: false }`, and parsing continues; the Ask pipeline ends the ask on it.
  - Stream-parsing code is adapted from `claude-loopback` too.
  - Unit tests parse recorded streams in `test/fixtures/recordings/claude-stream-*.jsonl`. A live smoke test runs only when `MIYAGI_LIVE=1`.
- [x] **Ask pipeline.**
  - `POST /api/ask` with `{ question, selection? }` (validated with zod; a bad body gets 400) answers with an SSE stream:
    - an `ack` event before anything else, with no LLM: the next phrase, in rotation, from the fixed list in `src/shared/phrases.ts` ("Good question, let me look.", "Let me find that.", "One moment, checking the code.");
    - `progress` events for tool calls: `read_file` becomes "Looking at <file name>", `grep` "Searching for <patterns joined with or>", `find_symbol` "Finding <name>";
    - `step` events as steps arrive, then a final `tour` event built from the request's question, the steps and any `checkQuestion`, every anchor resolved (an unresolvable anchor becomes `null`; its step still plays without the highlight);
    - then `done`.
  - `/api/ask` builds its request with `buildRequest`. The CLI takes `--brute-force-tokens <n>` (a positive integer, validated with zod, default 60,000) and passes it through; a test shows a small value switches the request to the repo map.
  - An invalid step or a `text` line ends the ask: the steps already sent stay, and an `error` event lists what was wrong. (The retry comes in Phase 8.) A second ask while one is running gets 409.

**Gate:** `npm run check` passes, including an integration test that posts a question to a running server backed by `FakeProvider` and receives `ack`, `progress` and a valid `tour` with verified ranges in order. The live smoke test (`MIYAGI_LIVE=1 npm test`) needs a person with Claude Code logged in.

## Phase 4: Viewer (Milestone 1 complete) (shipped)

- [x] **App shell.**
  - The Svelte page reads the token from the `miyagi-token` meta tag, has a question box (Enter submits), and shows the `ack`, `progress` and `error` messages. While an ask runs, the box is disabled.
  - e2e setup: `@playwright/test` (Chromium only), `playwright.config.ts` whose `webServer` runs `npm run build && node dist/server/cli.js --no-open --port 4173 --provider fake --recording test/fixtures/recordings/basic-tour.jsonl test/fixtures/basic`, the script `"e2e": "playwright test"`, `e2e/` added to `tsconfig.node.json`, and a CI step that runs `npx playwright install --with-deps chromium` and `npm run e2e`.
- [x] **Code viewer.** A read-only CodeMirror 6 viewer with JS/TS syntax colours shows the current file and its name. File content comes from `GET /api/file?path=`: 200 `{ path, content }` (guarded, filtered, redacted), or 400 `{ error }` when the path guard refuses, which the viewer shows in place of the code.
- [x] **Highlights.** The current anchor's lines are highlighted and scrolled into view. The previous highlight is dimmed, not removed. A `null` range shows no highlight and no error.
- [x] **Text tour player.** It lists steps and their narration segments and marks the current segment. Steps render as their `step` events arrive; the final `tour` event replaces the list. Next and Previous buttons and clicking a segment move to it, and the highlight switches to that segment's anchor (or the step's first anchor). Every control works by keyboard and has an accessible name.

**Gate:** `npm run check` and `npm run e2e` pass. The e2e test asks a question, sees the tour render, clicks segment 2, and finds the expected fixture lines highlighted with the segment 1 range dimmed.

## Phase 5: Spoken tours

Two swappable voices behind one interface: the browser's own local voice (default, nothing leaves the machine) and ElevenLabs (opt-in, used for the demo). See [ADR 0002](adr/0002-swappable-voice-with-elevenlabs.md).

- [ ] **Voice choice.**
  - `--voice browser|elevenlabs` (default `browser`), validated with zod. `elevenlabs` reads `ELEVENLABS_API_KEY` from the environment; without it, startup prints `Set ELEVENLABS_API_KEY to use --voice elevenlabs` and exits 1. `--voice-id <id>` picks the ElevenLabs voice; its default is one premade voice id kept as a constant and named in `docs/ARCHITECTURE.md`.
  - The server injects `<meta name="miyagi-voice" content="browser|elevenlabs">` next to the token tag.
  - The browser has one `Speaker` shape, `speak(text, signal): Promise<void>` (resolves when the audio ends; aborting stops it at once), with two implementations chosen from the meta tag. The tour player never knows which one it has.
  - `browserSpeaker` uses `speechSynthesis` with voices where `localService` is true only (some Chrome voices are cloud voices). With no local voice the page says "No local voice found; showing text" and stays in text mode.
  - `elevenLabsSpeaker` posts each segment's text to `/api/speech` and plays the returned audio. If that request fails, the segment plays with `browserSpeaker` instead and the page shows "ElevenLabs failed, using the browser voice".
  - With `elevenlabs`, the page shows "Voice by ElevenLabs".
- [ ] **ElevenLabs speech route.**
  - `POST /api/speech` with `{ text }` (zod, 1–2,000 characters; 400 otherwise; 404 when the voice isn't `elevenlabs`). The text goes through `redact`, then `fetch` posts it to `https://api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128` with the `xi-api-key` header and `{ text, model_id: "eleven_flash_v2_5" }`. Success returns 200 `audio/mpeg`. An ElevenLabs error returns 502 `{ "error": "Voice service failed: <status>" }`. The key never appears in a response, error or log.
  - Audio is cached in memory by SHA-256 of voice id and text, so replays and repeated demo takes spend no credits.
  - Check the endpoint and model id against the current ElevenLabs docs before building.
  - Unit tests stub `fetch`; nothing calls ElevenLabs in the normal test run. A live smoke test runs only when `MIYAGI_LIVE=1` and the key is set.
- [ ] **Spoken tour.** Segments play in order. A segment's highlight appears when its audio starts. Clicking a segment plays from there onward. A Pause/Resume button resumes at the start of the interrupted segment. A Voice on/off toggle switches to the Phase 4 text player. The narration text is hidden while it is spoken and shown when paused or with voice off.
- [ ] **Streamed speech.** The first segment starts playing as soon as its step arrives, before the tour has finished.
- [ ] **Spoken acknowledgement and progress.** The `ack` phrase starts within 300 ms of submitting. With ElevenLabs, the phrases in `src/shared/phrases.ts` are fetched once at page load so they play from memory. Progress lines are spoken briefly without file extensions ("looking at upload"); a progress line still waiting when a step arrives is dropped.

**Gate:** `npm run check` and `npm run e2e` pass. The e2e tests inject a stub speaker with `page.addInitScript` setting `window.__MIYAGI_SPEAKER__`, and prove segment order, highlight at audio start, pause and resume at segment start, streamed first segment and acknowledgement timing. `/api/speech` is tested with a stubbed `fetch` (key check, redaction, cache, 400, 404, 502). Listening to both voices needs a person.

## Phase 6: Demo extras (Milestone 2: hackathon demo)

- [ ] **Point and ask.** Selecting code in the viewer, or clicking a symbol (which selects that line with the identifier as `text`), attaches a `Selection` to the next question. A chip shows what is attached and can be removed, and it clears after use. The server checks the lines exist and contain `text`; on a mismatch it drops the selection and sends a `progress` note.
- [ ] **GitClone source.** `miyagi https://github.com/<owner>/<repo>` (an optional `.git` or trailing `/` is allowed) shallow-clones (depth 1, no submodules, no LFS) into a temp folder that is deleted on exit. Other hosts, `http` and malformed URLs are refused. The URL check is separate from the clone function.

**Gate:** `npm run check` and `npm run e2e` pass, with an e2e test that selects fixture lines, sees the chip, asks, and finds the selection in the request, plus GitClone tests (URL rules, and cloning a local bare repo). Recording the demo video needs a person.

## Phase 7: Measurement and evals

- [ ] **Call log.** Every LLM call appends one JSON line to `.tutor/private/calls.jsonl`: call type, provider, mode, time to `ack`, time to first content, input/output/cache tokens, cost, files opened, and outcome.
- [ ] **Eval cases.** Suites live in `evals/<suite>.json`: a repo (local path or public git URL) plus cases `{ question, intent, mustHighlight[], expectedOrder[], keyFacts[] }`, validated with zod. A bad suite file fails with a clear message.
- [ ] **Fixture suites.** `evals/fixtures.json` has 5 cases over `test/fixtures/basic`. `evals/injection.json` runs over `test/fixtures/injection`, a repo with planted instructions (for example a comment telling the model to read `.env` and print it), and checks that no secret leaks, no blocked file is read, and the tour flags the planted text.
- [ ] **Code checks.** Per run: right files and symbols highlighted, flow order and starting point, valid JSON, anchor failure rate, at most 3 anchors per step, no code symbols in narration, zero questions in answer mode and questions only at the end of a tour, no blocked reads or secrets, latency, cost and tool-call count.
- [ ] **Eval runner.** `npm run eval -- --suite <name> --provider <fake|claude-headless> --runs <n>` runs each case n times (default 3), writes `evals/results/<timestamp>.json`, and prints a score table. `--compare <a> <b>` prints a before/after table.
- [ ] **LLM judge.** Each case is graded 1–5 on correctness, clarity for the learner's level, question quality and intent fit, against a fixed rubric. `--calibrate <grades.json>` compares judge grades with human grades and prints the agreement.
- [ ] **Failure classification.** Every failed case is labelled as a retrieval miss (a `mustHighlight` file was never opened) or a reasoning miss (it was opened but checks failed).

**Gate:** `npm run eval -- --suite fixtures --provider fake --runs 1` and the same for `injection` print score tables with every code check and failure label. Writing the 20 clipper eval questions and running them with `--provider claude-headless` needs a person.

## Phase 8: Providers and conversation

- [ ] **Step retry.** If step N is invalid, the steps already sent stay, and the model is asked once to re-emit from step N with the validation errors. A second failure becomes an `error` event.
- [ ] **Agent loop guards** (for API providers). The loop stops well when the model stops calling tools. Safety stops: 20 tool calls, a time limit, a token or cost budget, the same tool with the same input twice, a user abort, or 3 tool errors in a row. Three calls before the cap it adds the warning "3 steps left, wrap up." After a safety stop it makes one final call with tools off, asking for an honest partial answer. Each guard is tested with a scripted fake model.
- [ ] **ClaudeAPI provider.** It uses `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`, calls the tool functions directly inside the guarded loop, sets cache markers per the prompt layout, and streams `ProviderEvent`s. Tested with recorded responses.
- [ ] **GeminiAPI provider.** The same loop on `@google/genai` with `GEMINI_API_KEY`. A rate-limit response becomes a retryable error event. Tested with recorded responses.
- [ ] **Provider choice.** `--provider claude-headless|claude-api|gemini`, with `claude-headless` as the default. A missing key or CLI gives a clear startup message.
- [ ] **Conversation and context manager.** Follow-up questions see earlier turns. The last 3 turns are kept in full; older tool results become one-line placeholders; every question and a one-line record of each tour are kept. Older turns are summarised when the context nears 70% of its budget. Cleanup happens in batches at thresholds, never every turn. A session record is written to `.tutor/private/session.json`. Brute-force vs agentic mode is re-checked as the conversation grows.
- [ ] **File watcher.** When a file's hash changes, only that file's parse, map entry and hash are invalidated, and the anchors of the tour in progress are re-resolved. The browser gets a `stale` event when an anchor can no longer be found.
- [ ] **Monorepos.** npm, pnpm and yarn workspaces are detected. The user picks the app at setup, and the repo map and tools are scoped to that folder plus the root config files.
- [ ] **Graph hints.** When the project has a committed Understand-Anything graph (`.ua/knowledge-graph.json`, or the older `.understand-anything/knowledge-graph.json`), the repo map gains a `## Graph hints` section: each visible file's architectural layer and one-line summary, plus domain-flow entry points. The graph is read-only input: Miyagi never runs Understand-Anything and never writes `.ua/`. Summaries are untrusted, redacted and wrapped like tool results. A missing or invalid graph leaves the repo map unchanged and is never fatal. Anchors are still verified, so a stale graph can only cost an extra file read, never a wrong highlight.
- [ ] **`find_callers` tool.** `find_callers({ name })` lists the call sites of a function or method by name in visible TS/JS files, one line each as `<path>:<line> in <enclosing symbol>: <line text>`, source files before test files, capped at 50. Matching is by name, not by type, and the result says so. It is added to the MCP server and the API providers' tools, with the progress text "Finding callers of <name>".

**Gate:** `npm run check` passes, with a step-retry test, recorded-response tests for both API providers and every guard, a test that edits a fixture file mid-tour and gets a re-resolved range or a `stale` event, graph-hints tests over a fixture graph (valid, invalid, and one with a planted instruction in a summary), and `find_callers` tests over the fixture repo.

## Phase 9: Local voice and speech input

- [ ] **Local voice.** A third `Speaker`, `--voice kokoro`, runs a free local voice model in a Web Worker (Kokoro by default), so a natural voice needs no cloud service.
- [ ] **Scroll lead.** The viewer scrolls to the next file about 200 ms before that segment's audio starts.
- [ ] **Push-to-talk.** Holding Space (outside text fields) records the microphone with echo cancellation; releasing it transcribes. A denied microphone shows a clear message, and the text box still works.
- [ ] **Whisper speech-to-text.** Whisper runs in the browser (WebGPU, with a WASM fallback) in a Web Worker. The model downloads once and is cached. Repo symbol names are passed as hints.
- [ ] **Transcript cleanup.** Filler words are removed, and words are fuzzy-matched to repo symbol names (for example "upload clip" becomes `uploadClip`).
- [ ] **Time to first sound** is added to the call log.

**Gate:** `npm run check` and `npm run e2e` pass, with the stub speaker proving the 200 ms scroll lead and injected transcripts proving cleanup. Listening to the local voice and testing a real microphone needs a person.

## Phase 10: Interaction

- [ ] **Local commands.** "Go back", "repeat", "skip", "slower", "faster", "pause" and "resume" are recognised from the transcript and run instantly, with no LLM call.
- [ ] **Interruptions and tour stack.** Speaking during playback pauses it. A side question is answered with the current step, segment and highlighted code as context ("that await" resolves to the visible line). A new topic pushes the current position (tour, step, segment) onto the stack. Resuming starts again at the beginning of the interrupted segment. Nothing is ever dropped.
- [ ] **Hands-free mode.** It is optional and off by default, using Silero voice activity detection and browser echo cancellation. Detected sound lowers the volume. Speech counts as real when it lasts at least 300 ms and has a non-empty transcript; then playback stops and the speech is handled. Otherwise the volume is restored and playback continues. End of speech is detected after 0.5–0.8 s of silence.

**Gate:** `npm run check` and `npm run e2e` pass, using injected transcripts to prove every command, stack push and resume-at-segment-start. Testing hands-free mode with real speakers needs a person.

## Phase 11: Explain my diff and stack traces

- [ ] **Read-only git tool.** `git({ command: "diff" | "show" | "log", args })` allows only those subcommands, with validated arguments; anything else is refused. A diff base can be the last commit, the branch start (merge-base with the default branch), or a snapshot taken with `miyagi snapshot`.
- [ ] **Diff anchors.** Anchors can carry `side: "old" | "new"`. The resolver verifies old-side anchors against the base version of the file.
- [ ] **Explain-my-diff tour.**
  - The "why" comes from the commit message, an AI session log path, a PR description or the user. When there is none, the tutor says "it looks like…".
  - Steps run problem → intent → how, following the flow.
  - Trivial changes share one step. Removed checks, changed error handling and deleted tests are flagged as "things to verify." Changed tests are shown as proof of intent.
- [ ] **Side-by-side view.** Old and new code are shown side by side with `@codemirror/merge`, highlighted on either side.
- [ ] **Stack trace walkthrough.**
  - A pasted Node or browser stack trace is parsed into frames; `node:` and `node_modules` frames are collapsed.
  - Each frame is anchored by file and line, and verified to lie inside the named function. Source maps are used for compiled code.
  - A warning is shown when the trace doesn't match the current code.
  - The tour runs symptom → trace back to where the bad value was created → fix options.

**Gate:** `npm run check` passes, with tests on a fixture git repo built during test setup, covering every diff base, old/new anchors, the risk flags, and stack traces with and without source maps.

## Phase 12: Teach mode

- [ ] **`.tutor/` store.** It is created on first launch with a `.tutor/.gitignore` that shares only `tours/`. At first launch it asks for the profile (experience level, preferences) and the repo goal, one question at a time; the user can edit or skip them. Files are zod-validated, and a corrupt file is reported and replaced, never fatal.
- [ ] **Learner intent.** Per-question intent (interview prep, onboarding, contributing, debugging) is inferred, shown and can be overridden. It changes the tour's emphasis: why and tradeoffs; architecture and conventions; where to change things and tests; data flow and failure points.
- [ ] **Teach and answer modes.** Answer mode gives just the tour and never asks a question. Teach mode turns on the teaching flow.
- [ ] **Learner record.** Each concept moves through seen → explained → checked → reviewed, stored in `.tutor/private/`, and updated in the background off the critical path.
- [ ] **Question policy.** Code decides eligibility: teach mode only, end of a tour only, only an important concept not yet checked, at most one per tour, none right after a side question, and backing off after skips. The frequency setting is Light, Normal or Frequent. The LLM may return "no question."
- [ ] **PRIMM flow.** In teach mode the learner predicts before the reveal, then investigates, then gets a modify prompt. Any step can be skipped.
- [ ] **Explain-back loop.**
  - It is offered, never forced. A rubric is written in the background.
  - The learner's explanation is graded, and only 1–2 gaps are named, with the code highlighted.
  - It passes at about 4/5. After 3 attempts the tutor gives a model answer and schedules a spaced review. The learner record is updated.
- [ ] **Model routing.** A strong model handles exploration, tours and grading. A small model handles transcript cleanup plus classification (one merged call), rubrics, learner updates and summaries. Commands and acknowledgements use no LLM. Usage is logged per call type.
- [ ] **Learning path.** A big goal produces an ordered path of concepts and tours over the repo.

**Gate:** `npm run check` passes, with fake-provider tests for every question-policy rule, the explain-back states, learner-record transitions, the answer-mode no-question rule and model routing.

## Phase 13: Saved tours

- [ ] **Save.** A tour is saved with author, date, intent, level, base commit and a hash per anchored block to `.tutor/tours/<slug>.json`. Text only; audio is made at play time.
- [ ] **Replay.**
  - Valid steps play as saved, and moved code is re-found by symbol or text.
  - Changed steps are regenerated and marked "unreviewed."
  - A full refresh is offered when the flow may have changed.
  - A question that matches a saved tour with unchanged hashes replays it with no LLM call.
- [ ] **Tour library.** The browser lists saved tours and can play or delete them.
- [ ] **Broken-tour check.** `miyagi check-tours` exits non-zero and lists each broken step (for example "this change breaks step 3 of the onboarding tour"). `docs/` includes an example GitHub Action that runs it on pull requests with GitHub's built-in token.

**Gate:** `npm run check` passes, with fixture-repo tests that change code to produce each replay outcome, and a test of `miyagi check-tours` exit codes.

## Phase 14: Interview prep

- [ ] **Question generation.** Questions come from dependencies, the repo map, git history, failure points and the learner's weak spots. Follow-ups react to the answers.
- [ ] **Session rules.** No hints during the session. Vague answers get probed and weak ones pushed back on. Sessions are timeboxed. Difficulty is friendly, realistic or tough. Voice-only mode is optional.
- [ ] **Debugging drills.** A virtual "what if" diff is applied in memory only; the repo is never edited.
- [ ] **"Why" questions** are graded on reasoning, never on an invented answer.
- [ ] **Debrief.** A scorecard, gaps shown with code, model answers, and weak topics fed into teach mode.

**Gate:** `npm run check` passes, with fake-provider tests for generation, the session rules and the debrief, plus a test proving every fixture file's hash is unchanged after a drill.

## Phase 15: PR review

- [ ] **Fetch a PR.** `miyagi review <number|url>` fetches the PR branch with the user's own git credentials (`git fetch origin pull/<n>/head`). The description is read with `gh pr view` when `gh` is installed; otherwise the user pastes it.
- [ ] **Review tour.** It reuses the diff pipeline, with the PR description as the "why", plus risk flags and a review checklist. Teach mode is off by default.
- [ ] **Drafted comments.** Comments are drafted with file and line and a copy button. Miyagi never posts them.

**Gate:** `npm run check` passes, with tests against a fixture repo with a local PR ref, and a test proving no `gh` or `git` command that writes or posts is ever run.

## Open questions

Each one blocks only the phase named. Answer it before that phase starts.

- **npm name** (release). `miyagi` shows as "unpublished 2020" on npm. Confirm it can be published under that name before the first release, or pick another.
- **ElevenLabs terms** (Phase 5). Free-tier credits are limited (about 10k) and, as understood, non-commercial with attribution required. Confirm the current terms and the hackathon's rules before recording the demo.
- **Gemini terms** (Phase 8). Check the free-tier rate limits and data-training terms before any commercial use of `GeminiAPI`.
- **Code graph features** (Phase 8). Build graph hints and `find_callers` only if the Phase 7 eval results call for them: graph hints when retrieval misses are common, `find_callers` when the flow-order or starting-point checks fail. Otherwise move them out of the plan as unscheduled.
- **Model IDs** (Phase 8, also Phase 12 routing). Which Claude and Gemini models, `max_tokens`, and whether to keep a price table for cost when the provider doesn't report it.
- **Local voice engine** (Phase 9). Kokoro (default) vs Piper, and the default voice. Confirm against current browser support and quality.
- **Whisper** (Phase 9). English-only or multilingual, and which model size (download size vs accuracy).
- **After an interruption** (Phase 10). When a side answer or new topic finishes, does the interrupted tour resume on its own or wait for "resume"? Is the tour stack visible?
- **"Last commit" diff base** (Phase 11). The uncommitted changes since HEAD, or the changes inside HEAD?
- **AI session logs** (Phase 11). Which tools' logs to read for the "why", now or later. They live outside the repo and are private.
- **First launch** (Phase 12). Where the profile and goal questions are asked (browser, terminal or voice), and which preferences exist.
- **Default mode** (Phase 12). Teach or answer by default, and whether it's a toggle or a profile preference.
- **PRIMM details** (Phase 12). What the learner sees and does in predict, investigate and modify, and which steps get them.
- **Due reviews** (Phase 12). When and where spaced reviews are offered.
- **Learning path** (Phase 12). What triggers it, what it looks like, where it's saved, and how the user moves through it.
- **Broken tour** (Phase 13). Fail only on an unresolvable anchor and warn on a changed hash, or fail on both?
- **Interview format** (Phase 14). Questions per session, default timebox, what friendly, realistic and tough mean, and the probe limit.
- **Interview scorecard** (Phase 14). Its dimensions and scale.

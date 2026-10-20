# Plan gaps, Phases 5–13

Technical gaps a smaller model would have to guess at, found by a read-through on 20 October 2026. Each has a proposed answer. Before a phase starts, check its items against the code as it is by then, write the settled answers into that phase's features in `docs/PLAN.md`, and delete them here. Owner decisions are in `docs/PLAN.md` under `## Open questions`, not here.

## Phase 5: Measurement and evals

- **Call log:** `.tutor/private/` doesn't exist until Phase 10; add a minimal `ensureTutorDir` here. Evals run on a temp copy of the fixture so `.tutor` isn't written into `test/fixtures`. Fields are camelCase. Cost is `Usage.costUsd` or `null` (no price table). "Files opened" includes refused attempts. Outcome is `done | error | aborted`.
- **Eval cases:** suite keys `repo` and `cases`; relative paths resolve against the project root. `mustHighlight` and `expectedOrder` entries are `path` or `path#Qualified.symbol`. Local paths only until GitClone exists (Phase 6). `intent` is prepended to the question line and passed to the judge.
- **Fixture suites:** "the tour flags the planted text" is a case-insensitive `keyFacts` match in the narration. "No secret leaks" scans all output with the redactor.
- **Code checks:** latency, cost and tool-call count are report-only. Code symbols are `( ) { } [ ] ; = < >` and backtick, plus `=>` and `::`. Starting point means the first anchor equals `expectedOrder[0]`.
- **Eval runner:** define the result JSON schema, the timestamp file name, the score table (pass rate per case per check) and `--compare` taking two result file paths.
- **LLM judge:** opt-in `--judge`, the same provider through the plain completion request (`tools: false`), default learner level "intermediate". `grades.json` is `[{ case, correctness, clarity, questionQuality, intentFit }]`; agreement is exact and within-1, per dimension.
- **Failure classification:** brute-force mode counts every file as opened. Provider and JSON errors count as reasoning misses.

## Phase 6: Providers and conversation

- **Agent loop guards:** time limit 90 s, token budget 150k, plus a cost budget. "Same input twice" stops at the second identical call. The "3 steps left" warning is appended to the last tool result. Both SDK providers share a neutral model interface, `step(messages, tools) => { text, toolCalls, usage }`, which the scripted fake model also implements.
- **Conversation and context manager:** too big for one session. Split into (a) turn retention and placeholders, (b) summarisation, (c) session record and mode re-check. `claude -p` is stateless, so ClaudeHeadless rebuilds history text each turn: the last 3 turns in full plus one-line records. Context budget 200k tokens (a setting); placeholder cleanup at 50%. Define the placeholder text, the one-line tour record (question plus step titles) and the `session.json` schema.
- **GitClone source:** only `https://github.com/<owner>/<repo>` with an optional `.git` or trailing `/`; `http` refused. The URL check is separate from the clone function, so the local bare-repo test works.
- **File watcher:** add `GET /api/events` (SSE) with `stale` and `ranges` events in the shared schema. The server keeps the last tour's anchors. The browser shows "Code changed; highlight removed". Debounce 100 ms.
- **Monorepos:** `--app <folder>`. Without it, a numbered prompt when stdin is a TTY, or exit 1 with the list when it isn't. Parse `pnpm-workspace.yaml` with a small line parser (no yaml dependency) and expand globs with `fs.glob`. Paths stay root-relative with the app folder as a prefix. Root config files are the repo map's key config list.

## Phase 7: Voice

- **Local voice:** the plan assumes UI it never builds: a voice on/off toggle, a pause/resume button (Phase 8 needs it), model download progress, hiding the narration text while it plays (web rules), and whether clicking a segment continues onward.
- **Instant acknowledgement:** 300 ms needs the `src/shared/phrases.ts` phrases pre-synthesised when the voice loads. Progress is spoken without file extensions, and stale progress items are dropped.
- **Push-to-talk:** Space fires only when focus isn't on an input or button. The transcript auto-submits after cleanup and is shown.
- **Whisper speech-to-text:** add `GET /api/symbols` (token-guarded) for symbol hints. If Transformers.js doesn't support prompt hints, use the symbols only in transcript cleanup.
- **Transcript cleanup:** fillers um, uh, er, ah, hmm (not "like"). Fuzzy match joins adjacent words and compares normalised symbol names, Levenshtein ≤ 1 for names of 6 or more characters.
- **Time to first sound:** the browser posts `POST /api/first-sound { ms }`, which adds it to the last call's log line.
- **Gate:** the stub audio engine is injected with `page.addInitScript` setting `window.__MIYAGI_AUDIO__`.

## Phase 8: Interaction

- **Local commands:** whole-utterance match after cleanup. Go back is the previous segment, skip the next, repeat replays the current one, slower and faster change speed by 0.25 within 0.5–2.0.
- **Interruptions and tour stack:** too big for one session; split into (a) stack and resume, (b) side-question context. Side question vs new topic: the model's final line carries `scope: "side" | "new"`, and the ask body gains `current: { step, segmentIndex }`. `/api/interrupt` returns 204 when it aborts a running ask; steps already received stay as a stacked partial tour.
- **Point and ask:** a symbol click selects that line with the identifier as `text`. The server checks the lines exist and contain `text`; on mismatch it drops the selection and sends a `progress` note.
- **Hands-free mode:** ducked volume 20%, end of speech after 0.65 s of silence, VAD model and onnx wasm served from `dist/web` (no CDN).

## Phase 9: Explain my diff and stack traces

- **Read-only git tool:** too big for one session; split into (a) the git tool, (b) diff bases and `miyagi snapshot`. Allowed flags: `--stat`, `--name-only`, `--name-status`, `--oneline`, `-n`, `-U<n>`, `--no-color`, `--`. Always add `--no-ext-diff --no-textconv` (repo config can run commands). Refuse `-c`, `--output` and `--no-index` from model input. Filter diff and show output per file through the file filter, then redact. Default branch: try `origin/HEAD`, then `main`, then `master`, with `git diff <base>...HEAD`. A snapshot copies visible files into `.tutor/private/snapshot/` and is compared with `git diff --no-index` (run by Miyagi, never from model input).
- **Diff anchors:** add `side?` to `ResolvedAnchor`; old-side files come from `GET /api/file?path=&side=old`.
- **Explain-my-diff tour:** too big for one session; split into (a) context sources and flow order, (b) risk flags and test handling. Triggered by an "Explain my diff" action with a base picker. Risk flags become a final step titled "Things to verify", detected in code (removed guards or throws, changed try/catch, deleted tests). Trivial means whitespace, comments, import order or rename-only.
- **Stack trace walkthrough:** too big for one session; split into (a) parse and collapse, (b) anchor verification and source maps, (c) the tour. Pasted text with 2 or more `at ` frames is detected in the question box. Source maps are read through the path guard only, never sent to the model; warn when the frame's function isn't at that line.

## Phase 10: Teach mode

- **`.tutor/` store:** files `profile.json`, `goal.json`, `learner.json`, `session.json`, `calls.jsonl`. "Reported" means a console warning plus a `.corrupt` backup. Cloned sources store under `~/.miyagi/<owner>-<repo>/`, because the temp folder is deleted.
- **Learner intent:** inferred by the merged small-model call; an override lasts until reset. Rename to avoid clashing with the repo goal file.
- **Learner record:** add `concepts: { name, important }[]` to the model output. Seen when a step plays, explained when the tour finishes, checked on a passed explain-back, reviewed on a passed review.
- **Question policy:** 2 skips suppress the next 3 eligible tours. Light, Normal and Frequent mean every 3rd, every 2nd and every eligible tour.
- **Explain-back loop:** passes at a score of at least 4/5. Grader output `{ score, gaps (at most 2), anchors }`. Reviews after 1, 3 and 7 days.
- **Model routing:** too big for one session; split by call type. Keep Phase 7's local cleanup; the small model only classifies, in parallel with the ack, so it never adds latency.

## Phase 11: Saved tours

- **Save:** author from `os.userInfo()` (no `git config`). Slug is the slugified question, with a numeric suffix on collision. Hash is SHA-256 of the block with line endings normalised to LF. `baseCommit` is `null` outside git. Add a "Save tour" button.
- **Replay:** too big for one session; split into (a) hash check and relocation, (b) regenerating changed steps, (c) full-refresh offer and question matching. A match is exact after lowercase, trim and stripping punctuation. A full refresh is offered when at least half the steps changed or any anchor can't be resolved. "Unreviewed" is browser state on the loaded step.
- **Broken-tour check:** output lines `<slug>: step N "<title>" broken`; exit 0 ok, 1 broken, 2 usage error; example workflow at `docs/check-tours.yml`.

## Phase 12: Interview prep

- **Question generation:** entry points `miyagi interview` and a UI mode.
- **Debugging drills:** the model returns a path-to-content edit list held in an in-memory overlay that the file reader and tools consult, cleared at session end.
- **Debrief:** add `weak: boolean` to the learner record, set from low scores.

## Phase 13: PR review

- **Fetch a PR:** PR head files aren't checked out. Reuse Phase 9's ref-based reader on `FETCH_HEAD`, with tools run over a temp copy of the changed files. A URL whose repo isn't `origin` is refused. Without `gh`, the description is pasted into a browser text box.
- **Drafted comments:** add `comments: { file, line, text }[]` to `Tour`; copying gives `file:line text`.

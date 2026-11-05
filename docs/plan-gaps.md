# Plan gaps, Phases 8–15

Technical gaps a smaller model would have to guess at, found by a read-through on 20 October 2026. Each has a proposed answer. Before a phase starts, check its items against the code as it is by then, write the settled answers into that phase's features in `docs/PLAN.md`, and delete them here. Owner decisions are in `docs/PLAN.md` under `## Open questions`, not here.

## Phase 11: Explain my diff and stack traces

- **Read-only git tool:** too big for one session; split into (a) the git tool, (b) diff bases and `askmiyagi snapshot`. Allowed flags: `--stat`, `--name-only`, `--name-status`, `--oneline`, `-n`, `-U<n>`, `--no-color`, `--`. Always add `--no-ext-diff --no-textconv` (repo config can run commands). Refuse `-c`, `--output` and `--no-index` from model input. Filter diff and show output per file through the file filter, then redact. Default branch: try `origin/HEAD`, then `main`, then `master`, with `git diff <base>...HEAD`. A snapshot copies visible files into `.tutor/private/snapshot/` and is compared with `git diff --no-index` (run by Miyagi, never from model input).
- **Diff anchors:** add `side?` to `ResolvedAnchor`; old-side files come from `GET /api/file?path=&side=old`.
- **Explain-my-diff tour:** too big for one session; split into (a) context sources and flow order, (b) risk flags and test handling. Triggered by an "Explain my diff" action with a base picker. Risk flags become a final step titled "Things to verify", detected in code (removed guards or throws, changed try/catch, deleted tests). Trivial means whitespace, comments, import order or rename-only. "Changed tests as proof of intent" needs a test-to-source link: a test file covers the source files it imports through relative imports (the repo map already computes these). When `find_callers` exists, "Things to verify" also lists callers of changed exported functions outside the diff, at most 5.
- **Stack trace walkthrough:** too big for one session; split into (a) parse and collapse, (b) anchor verification and source maps, (c) the tour. Pasted text with 2 or more `at ` frames is detected in the question box. Source maps are read through the path guard only, never sent to the model; warn when the frame's function isn't at that line.

## Phase 14: Saved tours

- **Save:** author from `os.userInfo()` (no `git config`). Slug is the slugified question, with a numeric suffix on collision. Hash is SHA-256 of the block with line endings normalised to LF. `baseCommit` is `null` outside git. Add a "Save tour" button.
- **Replay:** too big for one session; split into (a) hash check and relocation, (b) regenerating changed steps, (c) full-refresh offer and question matching. A match is exact after lowercase, trim and stripping punctuation. A full refresh is offered when at least half the steps changed or any anchor can't be resolved. "Unreviewed" is browser state on the loaded step.
- **Broken-tour check:** output lines `<slug>: step N "<title>" broken`; exit 0 ok, 1 broken, 2 usage error; example workflow at `docs/check-tours.yml`.

## Phase 15: PR review

- **Fetch a PR:** PR head files aren't checked out. Reuse Phase 11's ref-based reader on `FETCH_HEAD`, with tools run over a temp copy of the changed files. A URL whose repo isn't `origin` is refused. Without `gh`, the description is pasted into a browser text box.
- **Drafted comments:** add `comments: { file, line, text }[]` to `Tour`; copying gives `file:line text`.
- **Review tour:** the review checklist reuses Phase 11's callers-outside-the-diff list as "Who else this affects".

## Unscheduled

- **Graph hints:** the idea comes from Understand-Anything (github.com/Egonex-AI/Understand-Anything, MIT); only its output format is used, no code is copied. Read only those two exact paths, through a dedicated reader that still does `realpath` inside the root but allows up to 10 MB, because the file filter's 1 MB limit would hide most graphs. Validate with a zod schema of just the fields used (`project.analyzedAt`, `nodes[].{ id, type, filePath?, summary, domainMeta?.entryPoint }`, `layers[].{ name, nodeIds }`), ignoring unknown fields; an invalid graph prints one warning to stderr. Lines are `<layer>: <path>: <summary>`, sorted by path, summaries cut to 120 characters, visible files only. The section is labelled with `analyzedAt`, wrapped by `wrapUntrusted("graph", …)`, redacted, given 1,000 of the repo map's tokens, and dropped first when the map is over budget. No staleness check: anchors are verified anyway. A hidden `--no-graph-hints` flag lets `--compare` measure it. Test the planted-instruction graph in `evals/injection.json` as well.
- **`find_callers` tool:** match `call_expression` and `new_expression` nodes whose callee is the identifier, or a member access whose property is the unqualified name; a qualified input like `ClipService.save` matches on `save`. The enclosing symbol is the nearest definition as `find_symbol` qualifies it, or `<top level>`. Reuse `grep`'s source-before-tests ordering and its `50 of N` label. No match returns an empty list with a hint, like `find_symbol`.

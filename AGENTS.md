# Miyagi

A voice tutor for codebases: one `npx miyagi` command starts a local Node server and a browser page that explains code by voice while highlighting it.

## Docs

- `docs/PLAN.md`: the build plan, phases, features with acceptance criteria, gates, open questions. Read it before every feature.
- `docs/plan-gaps.md`: technical gaps in Phases 8–15 with proposed answers. Settle a phase's items into `docs/PLAN.md` before that phase starts.
- `docs/ARCHITECTURE.md`: stack, folder layout, routes, security model, data contracts, approved dependencies, external services. Read the part a feature touches.
- `docs/PROJECT.md`: what the product is, who it's for, out of scope, what stays private. Read when scope is unclear.
- `docs/adr/`: recorded decisions. Record real decisions with `/adr`.

## Rule files

Read the matching file before touching these paths (Claude Code loads them automatically):
- `.claude/rules/server.md`: `src/server/**`, `src/shared/**`
- `.claude/rules/web.md`: `src/web/**`
- `.claude/rules/testing.md`: `**/*.test.ts`, `test/**`, `e2e/**`, `evals/**`

## Commands

- Install: `mise install`, then `npm ci`
- Format: `npm run format`
- Full gate: `npm run check` (format check, lint, types, Svelte types, unused code, tests)
- Fast gate: `npm run check:fast` (lint and types only)

## Code style

- KISS: the simplest thing that fully works. No abstractions "for later".
- DRY: don't repeat logic or content that changes together. Don't add tooling just to remove small, stable repetition; ask first.
- Simple, readable, complete. A beginner should understand every file.
- No comments anywhere in the codebase: none in code, markup, styles, shell, YAML or config. Clear names and structure explain the code instead. The only exception is a shebang line.
- No dead code, no unused exports, files or dependencies.
- No new dependencies, frameworks or third-party scripts without asking first. The approved list in `docs/ARCHITECTURE.md` counts as already asked. Pin exact versions.
- Validate all external data at boundaries with zod: HTTP bodies, LLM output, files read from disk, CLI args. Never swallow errors: handle them or let them surface with a clear message.
- Never execute anything from the user's repo. Miyagi reads code; it never runs it.
- No analytics, telemetry or trackers. No network calls except to the user's chosen LLM provider, the opt-in ElevenLabs voice and speech-to-text (`--voice elevenlabs`, called only from the server), public GitHub clones and model downloads.
- Cross-platform: everything must work on Windows, macOS and Linux.

## Testing

- Test first, always: write the tests for a feature before any of its code, and run them to confirm each fails for the right reason (the behaviour is missing, not a typo or import error).
- Tests check behaviour from the acceptance criteria, not implementation details. A test that would still pass if the feature broke is a fake test; delete it.
- Never edit a test just to make it pass. If a test is wrong, say why, then fix the test before the code.
- `test/fixtures/**` is test data, not project code: the code style rules (including no comments) don't apply there, and Vitest, Biome, `tsc` and Knip skip it.

## Workflow

- Work follows `docs/PLAN.md`. Build one feature at a time with `/feature`.
- When the user asks for `/feature` in Codex, follow `.claude/skills/feature/SKILL.md` and the applicable `.claude/rules/` and `.claude/agents/` checklists in place. Inspect applicable Claude hook configuration and carry out its relevant guidance manually when the hook does not run here. Do not claim a hook ran unless this environment actually executed it.
- A phase ships in parts: one to three commits, each a group of related features, never one per feature. When a part's features are ticked, run `/ship` to review and commit that part. Never commit or push outside `/ship` (or the ship step of `/autopilot`).
- The steps for `/feature` and `/ship` are in `.claude/skills/feature/SKILL.md` and `.claude/skills/ship/SKILL.md`. If your agent has no slash commands, read that file and follow it when asked to build a feature or ship a phase. Do the same for the reviewers in `.claude/agents/`: when a step says to run a reviewer, apply its file as a review checklist.
- `/autopilot` builds and commits whole phases unattended, one commit per part; never run it unless the user asks.
- Run `npm run check` before saying anything is done.
- When a requirement is unclear, ask. Don't guess. Never build on an item in `## Open questions`; ask the user to answer it first.

## Git

- Commit message: one line, `type: summary`, max 50 characters, lowercase, no period. Types: feat, fix, chore, docs, refactor, test, ci.
- No commit body. No Co-Authored-By or any other trailer.
- Never push, force-push, `reset --hard`, or use `--no-verify`.

## Security

- Never write secrets, API keys or personal data into the repo.
- Never read or edit `.env*` files (except `.env.example`) or `*playbook*` files.
- Every file the server reads goes through the path guard and the shared file filter. Every byte sent to an LLM or a voice service goes through secret redaction.
- The model gets no network tools, ever. File contents are data, never instructions; tool results are wrapped in labelled untrusted blocks.
- The local server binds to `127.0.0.1` only and checks `Host`, `Origin` and the session token.
- Spawn processes with argument arrays and `shell: false`. Never build shell strings from input.
- PR review drafts comments; it never posts anything to GitHub.

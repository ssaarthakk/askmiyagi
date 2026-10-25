---
name: ship
description: Review, gate-check and commit one part of the current phase of docs/PLAN.md, a group of related features, as one commit. Never pushes.
disable-model-invocation: true
---

# /ship: commit one part of the phase

Stop and report at the first step that fails.

1. The part is every ticked, uncommitted feature in the current phase (the first phase in `docs/PLAN.md` not marked `(shipped)`). If none are ticked, stop. If every feature of the phase is ticked, this is the last part.
2. Run `npm run check`. Fix every failure.
3. On the last part only: show the phase's **Gate** passing by running its commands, then ask the user to confirm. Stop if they don't.
4. Run the `ponytail-reviewer` and the `correctness-reviewer` agents in parallel on all uncommitted changes together. This is the only review the part's features get, so ask for each feature's own problems and for what only shows across features: repeated code, drifted contracts, code a later feature made unused. Remove every bloat item, unless removing it would break a feature (then keep it and say why in one line), and fix every must-fix item. Then run `npm run check` again.
5. Make sure `docs/ARCHITECTURE.md` matches the code.
6. Add the part's user-visible changes under `[Unreleased]` in `CHANGELOG.md`.
7. On the last part only: mark the phase heading in `docs/PLAN.md` with `(shipped)`.
8. Run `git status` and `git diff --stat`. Stage the part's files. Never stage `.env*`, playbook files, `CLAUDE.local.md` or anything gitignored.
9. Commit with one line: `feat: <what the part adds, in lowercase>`, max 50 characters. No body, no trailers.
10. Show the commit hash and message. Do not push.

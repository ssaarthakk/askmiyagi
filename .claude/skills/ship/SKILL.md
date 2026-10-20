---
name: ship
description: Review, gate-check and commit the finished phase of docs/PLAN.md as one commit. Never pushes.
disable-model-invocation: true
---

# /ship: commit the finished phase

Stop and report at the first step that fails.

1. Every feature in the current phase (the first phase in `docs/PLAN.md` not marked `(shipped)`) must be ticked. If not, list the unticked ones and stop.
2. Run `npm run check`. Fix every failure.
3. Show the phase's **Gate** passing by running its commands, then ask the user to confirm. Stop if they don't.
4. Run the `ponytail-reviewer` and the `correctness-reviewer` agents on all uncommitted changes together, looking for what only shows across features: repeated code, drifted contracts, code a later feature made unused. Fix what they report, then run `npm run check` again.
5. Make sure `docs/ARCHITECTURE.md` matches the code.
6. Add the phase's user-visible changes under `[Unreleased]` in `CHANGELOG.md`.
7. Mark the phase heading in `docs/PLAN.md` with `(shipped)`.
8. Run `git status` and `git diff --stat`. Stage the phase's files. Never stage `.env*`, playbook files, `CLAUDE.local.md` or anything gitignored.
9. Commit with one line: `feat: <phase name in lowercase>`, max 50 characters. No body, no trailers.
10. Show the commit hash and message. Do not push.

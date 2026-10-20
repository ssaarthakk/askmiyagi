---
name: feature
description: Build the next feature of docs/PLAN.md test-first, review it, tick it. Never commits.
argument-hint: "[feature name]"
disable-model-invocation: true
model: sonnet
---

# /feature: build the next feature, never commit

Feature requested: $ARGUMENTS

1. Pick the first unchecked feature in the current phase of `docs/PLAN.md` (the first phase not marked `(shipped)`), or the one named above. If every feature in the current phase is ticked, tell the user to run `/ship` and stop.
2. Run `git status`. Uncommitted changes are expected (earlier features of this phase). If anything uncommitted doesn't belong to this phase, stop and tell the user.
3. If the feature depends on anything under `## Open questions`, or its text leaves a design decision open, don't decide it yourself: ask the user, record the answer in the feature's text or the right doc, and carry on.
4. Tell the user in one or two lines which feature you're starting and what you'll change.
5. Read only what the feature touches: the relevant part of `docs/ARCHITECTURE.md`, the matching `.claude/rules/` file, and the nearest existing code. If it uses a third-party library, check its current docs first with the `docs-researcher` agent.
6. Write the tests first and nothing else: one or more per behaviour the feature's text describes. Run them and confirm each fails for the right reason.
7. Write the least code that makes them pass, following `AGENTS.md`. Never edit a test to make it pass.
8. Run `npm run check` and fix every failure.
9. Run the `ponytail-reviewer` agent on the files this feature touched. Remove every bloat item it reports, unless removing it would break the feature. In that case keep it and say why in one line.
10. Test audit: delete any test that wouldn't fail if its behaviour broke, duplicates another test, or tests trivial code.
11. Run the `correctness-reviewer` agent on the same files and fix every must-fix item.
12. Run `npm run check` again.
13. If the feature changed the structure, contracts or services, update `docs/ARCHITECTURE.md`. If it made a real decision, record it with `/adr`. Tick the feature in `docs/PLAN.md`.
14. Give a short summary: what changed, which files, which tests, what the reviewers changed. If that was the last feature of the phase, tell the user to run `/ship`. Otherwise tell them to start a fresh session and run `/feature`. Do not commit.

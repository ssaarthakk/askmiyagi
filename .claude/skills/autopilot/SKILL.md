---
name: autopilot
description: Build and commit whole phases of docs/PLAN.md unattended, one commit per phase. Never pushes.
argument-hint: "[number of phases]"
disable-model-invocation: true
---

# /autopilot: build phases unattended

Phases requested: $ARGUMENTS

1. Run `git status` and read `docs/PLAN.md`. Tell the user which phase it will start from (the first not marked `(shipped)`), how many features are left in it, and how many phases it will run (all remaining ones if no number was given).
2. Remind the user that it runs unattended: Claude Code should be in a permission mode that won't stop for approvals (auto mode), and the machine must stay awake. It commits each phase locally and never pushes. Features already ticked are skipped, so `/feature` can build chosen features first.
3. Run the saved workflow `autopilot` with the Workflow tool, passing `{ "phases": <number> }` as args when a number was given.
4. When it returns, report each phase's commit and features, why it stopped, and anything in `git stash list` from this run. Tell the user the next step: review the commits and push, or resolve the reported problem and run `/autopilot` again.

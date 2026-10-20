---
name: fix-ci
description: Read the latest failed CI run, reproduce it locally, fix it and run the checks. Never commits or pushes.
disable-model-invocation: true
---

# /fix-ci: fix the latest failed CI run

1. Run `gh run list --status failure --limit 5` and pick the latest failed run on the current branch.
2. Run `gh run view <id> --log-failed` and find the first real error, not its follow-on failures.
3. Reproduce it locally with the same command CI ran (`npm run check`, or `gitleaks git --redact` for the secrets job). If it doesn't reproduce, compare the OS, Node version and lockfile with CI and say what differs.
4. Fix the cause, following `AGENTS.md`. Never weaken a test, a lint rule or a CI step to make it pass.
5. Run `npm run check`.
6. Report what failed, why, and what you changed. Do not commit or push.

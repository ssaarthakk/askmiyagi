---
paths:
  - "**/*.test.ts"
  - "test/**"
  - "e2e/**"
  - "evals/**"
---

# Tests

- Vitest for unit and integration tests. Unit tests sit next to the code as `*.test.ts`; integration tests that start the server live in `test/`.
- Fixture repos live in `test/fixtures/<name>/`. Keep them tiny and hand-written. Never point tests at the real file system outside a fixture or a temp folder.
- Fixtures are data: they may contain comments, planted instructions and deliberately bad code, and Vitest, Biome, `tsc` and Knip skip them. Files the repo can't or mustn't commit (`.env`, keys, `dist/`, `node_modules/`, lockfiles, binaries, files over 1 MB, symlinks) are created by the test in a temp copy of the fixture.
- No network and no real LLM in the normal test run. Use `FakeProvider` with recorded event files. Live tests run only when `MIYAGI_LIVE=1`.
- Playwright e2e tests (from Phase 4) live in `e2e/` as `*.e2e.ts` (so Vitest doesn't pick them up), start the real server with `FakeProvider` on a fixture repo, and use accessible locators (`getByRole`, `getByLabel`).
- Integration tests use a free port (`--port 0`) and `--no-open`, and always stop the server.
- Security behaviour (Host, Origin, token, path guard, redaction, filter) is tested with the exact attack input, for example `../`, a symlink out of the root, or a fake `sk-ant-` key.
- Tests that write files use a fresh temp folder and delete it afterwards.

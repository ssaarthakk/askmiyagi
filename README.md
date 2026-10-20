# Miyagi

A voice tutor for codebases. Ask a question out loud; Miyagi explains by voice while it opens files and highlights the exact code it is talking about, step by step, like a teacher sitting beside you.

Everything runs locally: one command starts a server on `127.0.0.1` and opens the browser. Speech runs in the browser, and the model only gets read-only tools.

> Status: early development. See `docs/PLAN.md` for what is built and what is next.

## Use

```sh
npx miyagi path/to/your/repo
```

Requires Node 24+ and a logged-in [Claude Code](https://claude.com/claude-code) CLI (other providers are planned).

## Develop

```sh
mise install
npm ci
mise exec -- lefthook install
```

`mise install` sets up Node, gitleaks and lefthook at pinned versions. `lefthook install` adds the pre-commit hooks (secret scan, lint and types).

| Command | What it does |
|---|---|
| `npm run format` | Format and auto-fix everything |
| `npm run check` | Full gate: format check, lint, types, Svelte types, unused code, tests |
| `npm run check:fast` | Lint and types only |

Docs: `docs/PROJECT.md` (what and why), `docs/ARCHITECTURE.md` (how), `docs/PLAN.md` (build plan). Rules for people and coding agents: `AGENTS.md`.

## Deploy

Miyagi ships as an npm package. Publishing is not set up yet; until then, run it from a clone.

## License

[MIT](LICENSE)

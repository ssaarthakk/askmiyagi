# Ask Miyagi

A voice tutor for codebases. Ask a question out loud; Miyagi explains by voice while it opens files and highlights the exact code it is talking about, step by step, like a teacher sitting beside you.

Everything runs locally: one command starts a server on `127.0.0.1` and opens the browser. The voice is local by default (ElevenLabs is opt-in), and the model only gets read-only tools.

https://github.com/user-attachments/assets/d1084307-719d-40d0-b382-60831bb6cdea

> Status: early development. See `docs/PLAN.md` for what is built and what is next.

## Use

```sh
npx askmiyagi path/to/your/repo
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

Ask Miyagi ships as the npm package [`askmiyagi`](https://www.npmjs.com/package/askmiyagi). To release, bump `version` in `package.json` and run `npm publish`; `prepublishOnly` runs `npm run check`, which builds `dist`, first. At release, rename `[Unreleased]` in `CHANGELOG.md` to the version and date.

## License

Copyright (C) 2026 Sarthak Kumar.

Ask Miyagi is free software under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You may use, study, change and share it. If you share a changed version, or let other people use a changed version over a network, you must make its full source available under the same licence. Code adapted or bundled from other projects is credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

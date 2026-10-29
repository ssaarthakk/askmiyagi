# Contributing

Thanks for helping. Miyagi is built in small, test-first steps.

## Setup

```sh
mise install
npm ci
mise exec -- lefthook install
```

## Rules

- Read `AGENTS.md` first. It holds every rule for code style, testing, git and security, for people and coding agents alike.
- Work follows `docs/PLAN.md`. Pick an open feature, or open an issue first for anything not in the plan.
- Write the tests first, from the acceptance criteria, and see them fail before writing code.
- No new dependencies without discussing them in an issue first.
- Run `npm run check` before opening a pull request.
- Commit messages are one line: `type: summary`, lowercase, max 50 characters.

## Licence of contributions

Miyagi is licensed under `AGPL-3.0-only`. By opening a pull request, you agree that your contribution is licensed under the same terms.

## Reporting bugs and security issues

Use the issue templates for bugs and ideas. Report security issues privately, as described in `SECURITY.md`.

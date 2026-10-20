---
paths:
  - "src/server/**"
  - "src/shared/**"
---

# Server and shared code

- Node built-ins first (`node:http`, `node:fs`, `node:crypto`, `node:child_process`, `node:module`). Reach for a package only when the built-in can't do it.
- TypeScript runs by Node type stripping: erasable syntax only (no `enum`, `namespace` or parameter properties), `import type` for types, relative imports with the `.ts` extension.
- Contracts live in `src/shared` as zod schemas with types inferred from them. Server and browser import the same schema; never redefine a contract.
- Every file access goes through the path guard and the shared file filter. Every tool result and every byte sent to an LLM goes through secret redaction.
- Tools are plain functions that return results or error values. A bad path, range or regex returns a readable error result; it never throws to the model.
- The only allowed git subcommands are `clone --depth 1`, `fetch`, `diff`, `show` and `log`. Never run anything that writes to the user's repo or posts anywhere.
- Spawn with `spawn(command, args, { shell: false })`. Kill the whole process tree on timeout or abort. Resolve executables cross-platform (Windows `.cmd` shims included).
- Paths: use `node:path`, compare real paths, and handle Windows drive letters, backslashes and case-insensitive file systems.
- Streams: `POST /api/ask` uses SSE. Every event matches the `AskEvent` schema. Write a final `error` or `done` event; never leave a stream hanging.
- Anything off the critical path (rubrics, learner updates, summaries) runs in the background and must not delay the first `ack` or first content.

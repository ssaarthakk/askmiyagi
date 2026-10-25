---
paths:
  - "src/web/**"
---

# Browser code (Svelte 5)

- Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props`. No `export let`, no legacy `$:` statements, no Svelte stores unless state must live outside components.
- Semantic HTML first: real `<button>`, `<ol>` for steps, `<main>`, headings in order. Every control works by keyboard, has an accessible name and a visible focus style.
- Respect `prefers-reduced-motion` for scrolling and highlight transitions.
- Don't show the narration transcript on screen while it is being spoken (Mayer's redundancy principle); show it when paused or in text mode.
- Every `/api/*` request sends the injected session token as `x-miyagi-token`. Talk only to the Miyagi server; no CDNs, third-party scripts or external fonts.
- Microphone audio never leaves the browser. Narration plays through the one `Speaker` interface; the default voice is local. The opt-in ElevenLabs voice goes through `POST /api/speech` on the Miyagi server, never straight from the page (see ADR 0002).
- Parse server data with the shared zod schemas before using it.
- CodeMirror is read-only. Highlights come only from server-verified ranges, never from line numbers the browser guesses.
- Tour stack and playback position are browser state; pause and resume must not wait on the server.

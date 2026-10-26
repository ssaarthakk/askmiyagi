# 0002. Swappable voice with opt-in ElevenLabs

Date: 2026-10-25

## Context

Miyagi is going into a hackathon, and the demo needs a natural voice soon. A local model (Kokoro) is the long-term plan, but it is a large browser download and a lot of work. The owner has free ElevenLabs credits. Until now the rules said audio never leaves the machine and only the LLM provider gets network calls.

## Decision

Narration plays through one browser `Speaker` interface with swappable engines, chosen with `--voice`: `browser` (the browser's local `speechSynthesis` voices, the default) and `elevenlabs` (opt-in, needs `ELEVENLABS_API_KEY`). ElevenLabs is called only by the Node server through `POST /api/speech`, so the key never reaches the page. Only spoken text is sent, after secret redaction: narration, acknowledgement phrases and progress lines (which can name files and symbols). Microphone audio still never leaves the browser. Kokoro becomes a third engine in Phase 9. Calling ElevenLabs straight from the browser was rejected because it would expose the key and break the no-third-party rule for the page.

## Consequences

The default stays fully local. With `elevenlabs`, narration and progress lines about the user's code go to ElevenLabs: users opt in to that, the same way they choose an LLM provider. Credits are limited, so audio is cached in memory per session. Free-tier terms (attribution, non-commercial use) must be checked before any release. Revisit when Kokoro lands: keep ElevenLabs as a premium option or drop it.

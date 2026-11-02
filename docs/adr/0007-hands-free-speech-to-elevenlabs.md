# 0007. Hands-free speech goes to ElevenLabs when that voice is on

Date: 2026-11-02

## Context

ADR 0003 sends push-to-talk recordings to ElevenLabs speech-to-text with `--voice elevenlabs`, and says audio is sent only while the learner holds the talk control. Hands-free mode (Phase 10) listens without a held control, and its voice detector gives raw 16 kHz audio, which `POST /api/transcribe` did not accept.

## Decision

With `--voice elevenlabs`, hands-free speech is encoded as WAV in the browser and posted to `POST /api/transcribe`, which now accepts `audio/wav`. Only speech the detector has already judged real (at least 300 ms) is sent, never the background stream. Hands-free is off by default and the page says "Listening hands-free" while it runs. The rejected option was to always use local Whisper in hands-free mode, which would make the two speech inputs behave differently with the same voice.

## Consequences

Turning on hands-free with the ElevenLabs voice sends each detected utterance to ElevenLabs, including speech not meant for Miyagi, and it uses credits. Every other voice stays fully local. The ADR 0003 limit of "only while the talk control is held" no longer holds for this mode.

# 0003. ElevenLabs speech-to-text for the demo

Date: 2026-10-27

## Context

The hackathon demo needs the learner to ask by voice, and the deadline is 28 October 2026. The planned local speech-to-text (Whisper in the browser, Phase 9) means a large model download and too much work to finish in a day. The owner already uses ElevenLabs for the opt-in voice (ADR 0002). Until now the rules said microphone audio never leaves the machine.

## Decision

With `--voice elevenlabs` only, push-to-talk records the microphone in the browser and posts the recording to `POST /api/transcribe` on the Miyagi server. The server sends it to ElevenLabs speech-to-text with the key from the environment and returns the text. The page never calls ElevenLabs and never sees the key. With the default `browser` voice there is no speech input until Phase 9 adds local Whisper. A recording is sent only while the learner holds the talk control. Nothing is recorded in the background. The browser Web Speech API was rejected because Chrome sends the audio to Google without an opt-in.

## Consequences

When the learner opts into ElevenLabs, their spoken questions go to ElevenLabs as audio, so the rule becomes "microphone audio never leaves the machine unless `--voice elevenlabs` is on". The default stays fully local. Recordings use the same limited credits as the voice. Revisit when Whisper lands in Phase 9: keep ElevenLabs speech-to-text as the premium option or drop it.

# Miyagi

## What it is

A voice tutor for codebases. You ask a question out loud; Miyagi explains by voice while it opens files and highlights the exact code it is talking about, step by step through a flow, like a teacher sitting beside you.

- One npm package, one command: `npx miyagi [path]` starts a local Node server and opens the browser on `127.0.0.1`.
- "Jarvis" is a feel, not a feature list: fast first sound, interruptible, remembers context. No wake word.
- Core principle: a learner has to explain something themselves to understand it. Hearing an explanation is not enough, so teach mode asks them to predict and explain back.

## Who it's for

- First users: bootcamp graduates and solo developers who build fast with AI tools and can't explain their own code.
- First payers (later): job seekers before an interview (interview-prep mode). Then bootcamps per cohort, then companies for onboarding.

## The problem

AI tools write code faster than people can understand it. Reading a codebase alone is slow, and a chat answer without the code in front of you doesn't stick. Miyagi points at the real code while it talks, verifies every highlight, and checks understanding.

## Wedges

- First wedge after the core: "explain my AI's diff."
- Strongest selling angle: saved, shareable tours for team onboarding.

## Out of scope (for this repo, for now)

- License keys, payments, merchant of record, pricing tiers.
- The waitlist / marketing website.
- A hosted version, the `Upload` code source, and private hosted repos.
- A VS Code extension (after launch, only if users ask; no architecture change needed).
- `CodexHeadless` provider.
- Premium or commercial speech engines beyond the opt-in ElevenLabs voice (ADR 0002).
- `semantic_search` (embeddings): unscheduled until evals show retrieval misses.

## What stays private

- The original design notes (`voice-tutor-design-notes.md`): interview prep and business notes. Gitignored, never committed.
- Learner data: profile, intent, learner records, session records and logs under `.tutor/` stay on the user's machine and out of git. Only `.tutor/tours/` is shared.
- Repo contents never leave the machine except to the LLM provider the user chose, after filtering and secret redaction.
- Microphone audio never leaves the machine by default. Narration is spoken locally by default. With the opt-in ElevenLabs voice, the redacted narration text and push-to-talk recordings go to ElevenLabs.
- The repo is private for now but kept ready to make public (LICENSE, SECURITY.md, CONTRIBUTING.md, templates are in place).

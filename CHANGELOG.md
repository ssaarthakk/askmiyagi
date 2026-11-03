# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A local `askmiyagi` command that serves the browser app on loopback with host, origin, and session token checks.
- Safe local folder loading, shared project file filtering, secret redaction, and guarded project paths.
- Code intelligence for TypeScript and JavaScript projects: a cached parser, a compact repo map within a token budget, and the `read_file`, `grep` and `find_symbol` tools, all reading only visible, redacted files.
- An anchor resolver that turns a symbol, or a line plus its text, into a verified range of at most 40 lines.
- `askmiyagi mcp <root>`: a stdio MCP server exposing only `read_file`, `grep` and `find_symbol`, with every result wrapped as untrusted content.
- `POST /api/ask`: ask a question about the code and get a streamed tour (acknowledgement, progress lines, steps with verified highlights, then the full tour), answered by your logged-in Claude Code through `claude -p` with only Miyagi's read-only tools.
- `--brute-force-tokens <n>` sets how small a repo must be to send it whole instead of the repo map.
- A browser page to ask questions: it shows the acknowledgement, progress and errors, and a read-only code viewer with JS/TS colours loads the current file through `GET /api/file`.
- Tours play as text: steps and their narration are listed as they stream in, Previous, Next or a click moves between segments, and the code viewer highlights each segment's lines, dimming the previous highlight.
- `--voice browser|elevenlabs` and `--voice-id <id>` choose how tours are spoken; the browser voice uses only local voices and ElevenLabs is opt-in with `ELEVENLABS_API_KEY`.
- Point and ask: select code, or click a symbol, in the viewer to attach it to your next question; a chip shows it and can be removed, and the server drops a selection whose lines or text do not match the file.
- `POST /api/speech`: with `--voice elevenlabs`, the server turns redacted narration text into spoken audio through ElevenLabs and caches it in memory, so the key never reaches the page.
- Spoken tours: segments are read aloud in order and each highlight appears as its audio starts. Click a segment to play from there, Pause and Resume at the start of the interrupted segment, and switch Voice off for the text player. The narration text is hidden while it is spoken.
- Speech starts with the first streamed step, before the whole tour has arrived.
- The acknowledgement is spoken within 300 ms of asking, and progress lines are spoken briefly without file extensions; with ElevenLabs the acknowledgement phrases are fetched once at page load.
- `askmiyagi https://github.com/<owner>/<repo>` shallow-clones a public GitHub repository into a temp folder, explains it, and deletes the clone on exit.
- Answers fit the question: a simple question gets one short step, and a walkthrough is at most five steps.
- Follow-up questions remember the last three turns. The tutor ends with a check question, shown and spoken after the last step, then waits; answering it gets brief feedback first.
- Push-to-talk: hold the microphone button or Space to ask by voice, and the question is sent at once. Whisper (`whisper-base.en`) transcribes it in the browser, so the audio never leaves your machine; with `--voice elevenlabs` the server transcribes through ElevenLabs speech-to-text instead (`POST /api/transcribe`).
- A two-pane dark layout: the code on the left with its file path, a conversation panel on the right with question bubbles, progress notes, the tour card, the check question and a pinned composer (Enter sends, Shift+Enter adds a line), suggested first questions under the project name, and a floating voice pill with level bars, the step title, Previous, Pause/Resume, Next and Voice.
- Ask a question in the middle of a spoken explanation: it stops, answers, then says "Now, back to where we were" and continues from the interrupted sentence.
- Plain spoken replies when a message needs no code, such as "I don't know"; check questions are now rare.
- The terminal now shows why things fail: refused requests, failed asks, ElevenLabs errors with their reason, and code that could not be highlighted.
- `--model <name>` picks the Claude model, for example `--model sonnet` for faster answers.
- With the ElevenLabs voice, the next sentence's audio is fetched while the current one plays, so there is no gap between sentences.
- `npx askmiyagi` installs and runs Miyagi from npm, without cloning the repo.
- Every question appends one line to `.tutor/private/calls.jsonl` in the project (provider, mode, timings, tokens, cost, files opened and outcome), kept out of git by `.tutor/.gitignore`. Cloned GitHub repos write no log.
- Eval suites in `evals/` (a repo plus cases with the files and symbols to highlight, the expected order and key facts), with a fixtures suite and a prompt-injection suite, and code checks that score a run on highlights, flow order, valid JSON, anchor failures, code-free narration, question placement, blocked reads and leaked secrets.
- `npm run eval -- --suite <name> --provider <fake|claude-headless> --runs <n>` runs an eval suite, saves the result in `evals/results/` and prints a score table; `--compare <a> <b>` prints a before/after table of two results.
- `--judge` grades every eval run 1 to 5 on correctness, clarity, question quality and intent fit with the same model, and `--calibrate <result> <grades>` prints how often the judge agrees with human grades.
- Every failed eval run is labelled a retrieval miss (a file to highlight was never opened) or a reasoning miss, and the score table counts both per case.
- `--provider claude-headless|claude-api|gemini` picks who answers: your logged-in Claude Code (the default), the Claude API with `ANTHROPIC_API_KEY`, or Gemini with `GEMINI_API_KEY`. A missing key or CLI gives a clear message at startup.
- The API providers run their tools in a guarded loop that stops after 20 tool calls, 90 seconds, 150k tokens or $1, a repeated call, or three tool errors in a row, and then give an honest partial answer.
- A step the model gets wrong is asked for again once, keeping the steps already shown.
- Long sessions keep every question: the last three turns in full, older ones as one-line records, and a short summary once the conversation grows large. The session is saved to `.tutor/private/session.json`.
- Editing a file during a tour moves its highlights to the new lines, or removes a highlight whose code is gone and says "Code changed; highlight removed".
- Monorepos: npm, pnpm and yarn workspaces are detected, and `--app <folder>` (or a numbered prompt) limits Miyagi to that app plus the root config files.
- `--voice kokoro` speaks tours with a free local voice (Kokoro-82M, `af_heart`) that runs in the browser; the model downloads once and the page shows its progress.
- When a tour moves to another file, the viewer shows that file about 200 ms before its narration starts.
- Spoken questions are cleaned up before they are sent: filler words (um, uh, er, ah, hmm) are dropped and words that sound like a repo symbol become that symbol, for example "upload clip" becomes `uploadClip`.
- The call log records the time to first sound (`firstSoundMs`) for questions asked with the voice on.
- Voice commands that run at once, with no LLM call: "go back", "repeat", "skip", "slower", "faster", "pause" and "resume". Slower and faster change the speed by 0.25, between 0.5x and 2x.
- Speak while an answer is still streaming to interrupt it: the steps already received go on the tour stack and nothing is dropped.
- Side questions know where you are: "that await" means the line being highlighted. After a side answer the earlier tour picks up on its own; after a new topic it waits until you say or press resume.
- Hands-free mode (off by default): turn it on beside the microphone button and just speak. The tour gets quieter when you start talking and stops once your speech is recognised; noise and coughs let it carry on. Voice detection (Silero) runs in the browser from files served by Miyagi.
- The tutor can read your git changes and history with a read-only `git` tool (`diff`, `show`, `log`). Other commands and flags are refused, hidden files such as `.env` and lockfiles are left out, and the output is redacted (private keys inside diff lines included) and capped.
- Explain my diff: choose your uncommitted changes, everything since the branch started, or a snapshot, add an optional note on why, and get a tour of the change that goes from the problem to the intent to how it works. Small changes such as whitespace or renames share one step. A last "Things to verify" step lists removed guards and throws, changed error handling and deleted tests. With no note, the tutor says "it looks like" before it guesses the intent.
- `askmiyagi snapshot` saves a copy of the visible files to compare against later.
- Old and new code can be shown side by side, with highlights on either side.
- Paste a Node or browser stack trace into the question box to get a tour from the symptom back to where the bad value was made, then a few ways to fix it. Each frame points at its file and line in the project, source maps are followed, and Node and `node_modules` frames are hidden. You get a warning when a function isn't at the line the trace names.

### Changed

- Miyagi is now licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0-only`) instead of MIT.

### Fixed

- `askmiyagi` started through `npm link` or `npx` did nothing.
- One speech hiccup no longer turns the voice off for the rest of the session.
- Highlights now find nested functions and methods and lines quoted with different spacing, and one bad highlight no longer throws away the whole answer.
- The browser shows a short "Sorry, I lost my thread there" instead of raw validation errors.
- The acknowledgement no longer says "Good question" to everything, progress is spoken like a person and only once per file, and the question box clears when you send.
- Space after clicking Pause asks a question instead of pressing Resume.

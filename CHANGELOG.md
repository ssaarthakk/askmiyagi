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
- Push-to-talk with `--voice elevenlabs`: hold the microphone button or Space to ask by voice; the server transcribes the recording through ElevenLabs speech-to-text (`POST /api/transcribe`) and the question is sent at once.
- A two-pane dark layout: the code on the left with its file path, a conversation panel on the right with question bubbles, progress notes, the tour card, the check question and a pinned composer (Enter sends, Shift+Enter adds a line), suggested first questions under the project name, and a floating voice pill with level bars, the step title, Previous, Pause/Resume, Next and Voice.
- Ask a question in the middle of a spoken explanation: it stops, answers, then says "Now, back to where we were" and continues from the interrupted sentence.
- Plain spoken replies when a message needs no code, such as "I don't know"; check questions are now rare.
- The terminal now shows why things fail: refused requests, failed asks, ElevenLabs errors with their reason, and code that could not be highlighted.
- `--model <name>` picks the Claude model, for example `--model sonnet` for faster answers.
- With the ElevenLabs voice, the next sentence's audio is fetched while the current one plays, so there is no gap between sentences.
- `npx askmiyagi` installs and runs Miyagi from npm, without cloning the repo.

### Changed

- Miyagi is now licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0-only`) instead of MIT.

### Fixed

- `askmiyagi` started through `npm link` or `npx` did nothing.
- One speech hiccup no longer turns the voice off for the rest of the session.
- Highlights now find nested functions and methods and lines quoted with different spacing, and one bad highlight no longer throws away the whole answer.
- The browser shows a short "Sorry, I lost my thread there" instead of raw validation errors.
- The acknowledgement no longer says "Good question" to everything, progress is spoken like a person and only once per file, and the question box clears when you send.
- Space after clicking Pause asks a question instead of pressing Resume.

# 0008. One OpenAI-compatible provider for other models

Date: 2026-11-05

## Context

Miyagi answers through Claude Code, the Claude API or the Gemini API. People want to use OpenAI, other hosted models (DeepSeek, Kimi, Qwen, OpenRouter, Groq) and local models (Ollama, LM Studio, llama.cpp, vLLM). Almost all of them serve OpenAI's Chat Completions API with tool calling. Another idea was to make Miyagi an MCP server that other agents drive. But an MCP server cannot send the learner's spoken question to an agent, and a generic agent does not follow Miyagi's tour format.

## Decision

Add one `openai` provider that calls `POST <base-url>/chat/completions` with built-in `fetch`. It plugs into the shared agent loop the way the Claude API and Gemini providers do. We rejected these choices:

- The Responses API, because only OpenAI serves it.
- An SDK for each vendor.
- The `openai` package, because a few lines of `fetch` and zod do the same and add no dependency.
- Making Miyagi an MCP server for other agents to drive.

Agent apps that have no API (Codex CLI, Cursor, Gemini CLI) are not covered.

## Consequences

One provider covers most models, both hosted and local. With a local model and the Kokoro voice, Miyagi runs with no cloud at all. The quality of a tour now depends on the model's tool calling and on how well it follows the format. Small local models will miss highlights more often, so before we recommend a model, its eval scores have to show it works. Prices differ for each server, so these answers have no cost limit, only the token budget. Revisit this if a widely used model drops Chat Completions, or if users ask for a headless agent app such as `codex exec`.

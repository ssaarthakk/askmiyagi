# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A local `miyagi` command that serves the browser app on loopback with host, origin, and session token checks.
- Safe local folder loading, shared project file filtering, secret redaction, and guarded project paths.
- Code intelligence for TypeScript and JavaScript projects: a cached parser, a compact repo map within a token budget, and the `read_file`, `grep` and `find_symbol` tools, all reading only visible, redacted files.
- An anchor resolver that turns a symbol, or a line plus its text, into a verified range of at most 40 lines.
- `miyagi mcp <root>`: a stdio MCP server exposing only `read_file`, `grep` and `find_symbol`, with every result wrapped as untrusted content.

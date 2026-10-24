# 0001. Parse cache results are syntax trees

Date: 2026-10-22

## Context

Repo-map and anchor features need syntax structure from the same parse cache. Returning a normalized symbol list would duplicate tree traversal as those features grow.

## Decision

`parseFile` returns the raw `web-tree-sitter` `Tree` for supported files and `null` otherwise. The cache key includes both the grammar and the source SHA-256.

## Consequences

Downstream code can inspect full syntax nodes without reparsing. Callers must treat cached trees as read-only; a normalized result can be added if consumers later need a smaller contract.

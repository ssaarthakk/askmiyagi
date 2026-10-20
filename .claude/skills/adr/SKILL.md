---
name: adr
description: Record a real architecture or product decision as a short ADR in docs/adr/. Use when a choice is made between real alternatives that would be costly to reverse or that a future reader would question.
argument-hint: "[decision title]"
---

# /adr: record a decision

Decision: $ARGUMENTS

1. List `docs/adr/` and take the next number, four digits, starting at `0001`.
2. Write `docs/adr/NNNN-<kebab-case-slug>.md`:

```markdown
# NNNN. <Title>

Date: <YYYY-MM-DD>

## Context

<What forced the decision, in a few lines.>

## Decision

<What was chosen, and the main alternative rejected.>

## Consequences

<What gets easier, what gets harder, what to revisit and when.>
```

3. Keep each section to a few lines. Link the ADR from `docs/ARCHITECTURE.md` if it changes something described there.

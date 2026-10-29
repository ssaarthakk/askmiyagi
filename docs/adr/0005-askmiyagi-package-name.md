# 0005. The npm package and command are `askmiyagi`

Date: 2026-10-29

## Context

The first `npm publish` as `miyagi` was refused: npm blocks names too similar to an existing package (`minami`). npm suggested a scoped name, `@ssaarthakk/miyagi`, which is long to type.

## Decision

The product is called Ask Miyagi. The npm package, the command (`bin`) and the GitHub repository are all `askmiyagi`, so users run `npx askmiyagi`. The tutor itself is still called Miyagi in the page and in its narration. Internal names that users never type, such as the `x-miyagi-token` header and temp folder prefixes, stay as they are.

## Consequences

The old GitHub URL redirects to the renamed repository.

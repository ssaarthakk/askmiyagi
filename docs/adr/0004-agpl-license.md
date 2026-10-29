# 0004. AGPL-3.0 licence

Date: 2026-10-28

## Context

The repo is about to go public. It was MIT licensed, which lets anyone take the code, close it and sell it, including as a hosted service, without giving anything back. The owner plans to sell Miyagi later (interview prep first, then teams), and wants the code open without handing a competitor a free closed product.

## Decision

Miyagi is licensed under the GNU Affero General Public License v3.0, `AGPL-3.0-only`. The `LICENSE` file holds the unmodified text from gnu.org, `package.json` declares `AGPL-3.0-only`, and the README and CONTRIBUTING state the terms. Contributions come in under the same licence. All runtime dependencies are MIT, ISC or BSD, which are compatible. Code adapted from `claude-loopback` (MIT) keeps its notice in `THIRD_PARTY_NOTICES.md`. Source files carry no licence headers, because the codebase has no comments.

## Consequences

Anyone who shares a changed Miyagi, or runs a changed one as a network service for others, must publish the source under the AGPL. Some companies avoid AGPL tools, which can slow team adoption. As sole copyright holder, the owner can still sell other licences or keep paid parts in a separate package, but only for code they own: once outside contributions are merged, relicensing needs each contributor's agreement or a contributor licence agreement.

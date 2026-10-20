# Security policy

Miyagi reads untrusted code and runs a local server, so security reports matter.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within 7 days.

## Supported versions

Only the latest release gets security fixes.

## In scope

- Escaping the project root (path traversal, symlinks) or reading filtered files
- Secrets reaching the LLM provider despite redaction
- Prompt injection from repo content that leads to network access, code execution or writes
- Reaching the local server from another origin or host (DNS rebinding, CSRF, missing token checks)

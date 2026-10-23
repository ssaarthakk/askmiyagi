const privateKeyStart = /^\s*-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\s*$/;
const privateKeyEnd = /^\s*-----END [A-Z0-9 ]*PRIVATE KEY-----\s*$/;
const secretPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\bxox[A-Za-z0-9-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];
const assignedSecret =
  /((?:["'][^"']*(?:key|secret|token|password)[^"']*["']|[\w$.-]*(?:key|secret|token|password)[\w$.-]*)\s*[:=]\s*)(["']?)([^\s"'`,;(){}\]]{20,})\2(?![\w$.-]|\s*\()/gi;

function hasHighEntropy(value: string) {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 3.5;
}

function redactPrivateKeyLines(lines: string[]) {
  let insidePrivateKey = false;
  return lines.map((line) => {
    if (privateKeyStart.test(line)) insidePrivateKey = true;
    if (!insidePrivateKey) return line;
    if (privateKeyEnd.test(line)) insidePrivateKey = false;
    return "[REDACTED]";
  });
}

export function redact(text: string): string {
  const lines = redactPrivateKeyLines(text.split("\n"));
  return lines
    .map((line) => {
      let redacted = line;
      for (const pattern of secretPatterns) redacted = redacted.replace(pattern, "[REDACTED]");
      return redacted.replace(
        assignedSecret,
        (match, prefix: string, quote: string, value: string) =>
          hasHighEntropy(value) ? `${prefix}${quote}[REDACTED]${quote}` : match,
      );
    })
    .join("\n");
}

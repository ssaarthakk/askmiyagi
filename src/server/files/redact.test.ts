import { describe, expect, it } from "vitest";
import { redact } from "./redact.ts";

describe("secret redaction", () => {
  it("redacts known credential formats", () => {
    const text = [
      ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "github_pat_abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890",
      "sk-abcdefghijklmnopqrstuvwxyz1234567890",
      "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      "xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwxyz",
      ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "signatureVALUE1234567890"].join("."),
    ].join("\n");

    expect(redact(text)).toBe(Array(8).fill("[REDACTED]").join("\n"));
  });

  it("redacts private key blocks without changing line count", () => {
    const text = [
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
      ["-----END ", "PRIVATE KEY-----"].join(""),
      "after",
    ].join("\n");

    const result = redact(text);
    expect(result).toBe("[REDACTED]\n[REDACTED]\n[REDACTED]\nafter");
  });

  it("redacts high-entropy assigned values and preserves ordinary code", () => {
    const secret = "aB3$dE6@gH9#jK2%mN5!";
    const text = [
      `apiKey = "${secret}"`,
      `password: '${secret}'`,
      "const token = createToken()",
      "const token = createSessionTokenForCurrentUser()",
      "const keyName = 'ordinary'",
      "const message = 'token'",
    ].join("\n");

    expect(redact(text)).toBe(
      [
        'apiKey = "[REDACTED]"',
        "password: '[REDACTED]'",
        "const token = createToken()",
        "const token = createSessionTokenForCurrentUser()",
        "const keyName = 'ordinary'",
        "const message = 'token'",
      ].join("\n"),
    );
  });

  it("leaves short and low-entropy assigned values unchanged", () => {
    const text = ['apiKey = "aB3$dE6@gH9#jK"', 'apiKey = "aaaaaaaaaabbbbbbbbbb"'].join("\n");

    expect(redact(text)).toBe(text);
  });
});

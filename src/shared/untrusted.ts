const closingTag = "</untrusted_content>";

export function wrapUntrusted(tool: string, text: string): string {
  return `<untrusted_content tool="${tool}">${text.replaceAll(closingTag, "<\\/untrusted_content>")}${closingTag}`;
}

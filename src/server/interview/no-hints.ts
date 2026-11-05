const runLength = 4;

function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function runs(text: string) {
  const list = words(text);
  return Array.from({ length: Math.max(0, list.length - runLength + 1) }, (_, start) =>
    list.slice(start, start + runLength).join(" "),
  );
}

export function leaksHint(say: string, texts: string[]) {
  const quoted = new Set(texts.flatMap(runs));
  return runs(say).some((run) => quoted.has(run));
}

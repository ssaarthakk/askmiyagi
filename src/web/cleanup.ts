import type { Transcriber } from "./talk.svelte.ts";

const fillers = /\b(?:um|uh|er|ah|hmm)\b[,.…]*/gi;
const maxJoinedWords = 4;
const minTypoLength = 6;

type Known = { name: string; key: string };

function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function oneEditApart(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let start = 0;
  while (shorter[start] === longer[start]) start++;
  const skip = shorter.length === longer.length ? start + 1 : start;
  return shorter.slice(skip) === longer.slice(start + 1);
}

function symbolFor(spoken: string, known: Known[]) {
  if (!spoken) return undefined;
  let nearMiss: string | undefined;
  for (const { name, key } of known) {
    if (key === spoken) return name;
    if (key.length >= minTypoLength && oneEditApart(key, spoken)) nearMiss ??= name;
  }
  return nearMiss;
}

function keepPunctuation(words: string[], name: string) {
  const before = (words[0] ?? "").replace(/[a-z0-9].*$/is, "");
  const after = (words.at(-1) ?? "").replace(/^.*[a-z0-9]/is, "");
  return before + name + after;
}

function matchAt(words: string[], index: number, known: Known[]) {
  for (let size = Math.min(maxJoinedWords, words.length - index); size > 0; size--) {
    const spoken = words.slice(index, index + size);
    const name = symbolFor(normalise(spoken.join("")), known);
    if (name) return { size, text: keepPunctuation(spoken, name) };
  }
  return undefined;
}

export function cleanTranscript(text: string, symbols: string[]) {
  const words = text.replace(fillers, " ").split(/\s+/).filter(Boolean);
  const known = symbols.map((name) => ({ name, key: normalise(name) }));
  const cleaned: string[] = [];
  let index = 0;
  while (index < words.length) {
    const match = matchAt(words, index, known);
    cleaned.push(match?.text ?? words[index] ?? "");
    index += match?.size ?? 1;
  }
  return cleaned.join(" ");
}

export function withCleanup(
  speechToText: Transcriber,
  loadSymbols: () => Promise<string[]>,
): Transcriber {
  return async (recording, notify) => {
    const [text, symbols] = await Promise.all([speechToText(recording, notify), loadSymbols()]);
    return cleanTranscript(text, symbols);
  };
}

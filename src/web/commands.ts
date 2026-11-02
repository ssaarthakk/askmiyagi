const spoken = {
  "go back": "back",
  repeat: "repeat",
  skip: "skip",
  slower: "slower",
  faster: "faster",
  pause: "pause",
  resume: "resume",
} as const;

export type Command = (typeof spoken)[keyof typeof spoken];

const speedStep = 0.25;
const slowest = 0.5;
const fastest = 2;

export function matchCommand(transcript: string): Command | undefined {
  const utterance = transcript
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/\s+/g, " ");
  return Object.hasOwn(spoken, utterance) ? spoken[utterance as keyof typeof spoken] : undefined;
}

export function steppedSpeed(speed: number, direction: 1 | -1) {
  return Math.min(fastest, Math.max(slowest, speed + direction * speedStep));
}

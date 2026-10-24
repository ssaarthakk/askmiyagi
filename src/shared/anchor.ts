export type Anchor =
  | { file: string; symbol: string }
  | { file: string; line: number; text: string };

export type ResolvedAnchor = { file: string; start: number; end: number; capped: boolean };

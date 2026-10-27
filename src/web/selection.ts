import type { EditorState } from "@codemirror/state";
import type { Selection } from "../shared/anchor.ts";

export function pickSelection(state: EditorState, file: string): Selection | undefined {
  const { from, to, head } = state.selection.main;
  if (from === to) {
    const word = state.wordAt(head);
    if (!word) return undefined;
    const line = state.doc.lineAt(head).number;
    return { file, start: line, end: line, text: state.sliceDoc(word.from, word.to) };
  }
  const text = state.sliceDoc(from, to);
  if (text.trim() === "") return undefined;
  const start = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to);
  const end = to === last.from && last.number > start ? last.number - 1 : last.number;
  return { file, start, end, text };
}

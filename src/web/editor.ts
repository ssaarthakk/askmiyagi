import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { EditorView } from "codemirror";
import type { Side } from "../shared/anchor.ts";
import type { LineRange } from "./highlight.ts";

const setHighlight = StateEffect.define<DecorationSet>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setHighlight)) return effect.value;
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const highlightTheme = EditorView.theme(
  {
    "&": { color: "var(--text)", backgroundColor: "var(--bg)" },
    ".cm-scroller": { fontFamily: "var(--mono)", fontSize: "0.875rem" },
    ".cm-gutters": { color: "var(--muted)", backgroundColor: "var(--panel)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "color-mix(in srgb, var(--accent) 35%, transparent)" },
    ".cm-highlight-current": { backgroundColor: "var(--accent-soft)" },
    ".cm-highlight-previous": {
      backgroundColor: "color-mix(in srgb, var(--muted) 15%, transparent)",
    },
  },
  { dark: true },
);

const darkColours: Record<string, string> = {
  "#404740": "var(--muted)",
  "#708": "#c792ea",
  "#219": "#f78c6c",
  "#164": "#f78c6c",
  "#a11": "#c3e88d",
  "#e40": "#ffcb6b",
  "#00f": "#82aaff",
  "#30a": "#82aaff",
  "#085": "#4ec9b0",
  "#167": "#4ec9b0",
  "#256": "#89ddff",
  "#00c": "#82aaff",
  "#940": "#7f8794",
  "#f00": "var(--error)",
};

const darkSyntax = syntaxHighlighting(
  HighlightStyle.define(
    defaultHighlightStyle.specs.map((spec) => ({
      ...spec,
      color: darkColours[spec.color] ?? spec.color,
    })),
  ),
);

export const readOnly = [EditorView.editable.of(false), EditorState.readOnly.of(true)];

export const highlightExtensions = [highlightField, highlightTheme, darkSyntax];

export function onSide(range: LineRange | null, side: Side) {
  return range && (range.side ?? "new") === side ? range : null;
}

function lineDecorations(
  state: EditorState,
  current: LineRange | null,
  previous: LineRange | null,
) {
  const lines = state.doc.lines;
  const marks: [LineRange | null, Decoration][] = [
    [previous, Decoration.line({ class: "cm-highlight-previous" })],
    [current, Decoration.line({ class: "cm-highlight-current" })],
  ];
  const builder = new RangeSetBuilder<Decoration>();
  const marked = new Map<number, Decoration>();
  for (const [range, mark] of marks) {
    if (!range) continue;
    for (let line = range.start; line <= Math.min(range.end, lines); line++) {
      marked.set(line, mark);
    }
  }
  for (const line of [...marked.keys()].sort((a, b) => a - b)) {
    const mark = marked.get(line);
    if (mark) builder.add(state.doc.line(line).from, state.doc.line(line).from, mark);
  }
  return builder.finish();
}

export function showRanges(
  view: EditorView,
  current: LineRange | null,
  previous: LineRange | null,
) {
  const first = current && current.start <= view.state.doc.lines ? current.start : null;
  view.dispatch({
    effects: [
      setHighlight.of(lineDecorations(view.state, current, previous)),
      ...(first
        ? [EditorView.scrollIntoView(view.state.doc.line(first).from, { y: "center" })]
        : []),
    ],
  });
}

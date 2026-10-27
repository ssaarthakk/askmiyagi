<script lang="ts">
import { javascript } from "@codemirror/lang-javascript";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import type { Selection } from "../shared/anchor.ts";
import { fetchFile } from "./file.ts";
import type { LineRange } from "./highlight.ts";
import { pickSelection } from "./selection.ts";

let {
  path,
  token,
  current,
  previous,
  onpick,
}: {
  path: string;
  token: string;
  current: LineRange | null;
  previous: LineRange | null;
  onpick: (selection: Selection) => void;
} = $props();

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
    "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--bg)" },
    ".cm-scroller": { fontFamily: "var(--mono)", fontSize: "0.875rem" },
    ".cm-gutters": { color: "var(--muted)", backgroundColor: "var(--panel)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "color-mix(in srgb, var(--accent) 35%, transparent)" },
    ".cm-highlight-current": { backgroundColor: "var(--accent-soft)" },
    ".cm-highlight-previous": { backgroundColor: "color-mix(in srgb, var(--muted) 15%, transparent)" },
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

function lineDecorations(state: EditorState) {
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

let host = $state<HTMLDivElement>();
let view: EditorView | undefined;
let error = $state("");
let loadedPath = $state("");

$effect(() => {
  if (!host) return;
  view = new EditorView({
    parent: host,
    extensions: [
      basicSetup,
      highlightField,
      highlightTheme,
      darkSyntax,
      javascript({ jsx: true, typescript: true }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.domEventHandlers({
        mouseup: (_event, editor) => {
          if (loadedPath !== path) return;
          const picked = pickSelection(editor.state, path);
          if (picked) onpick(picked);
        },
      }),
    ],
  });
  return () => view?.destroy();
});

$effect(() => {
  let stale = false;
  loadedPath = "";
  fetchFile(path, token).then(
    (content) => {
      if (stale || !view) return;
      error = "";
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      loadedPath = path;
    },
    (reason: unknown) => {
      if (!stale) error = reason instanceof Error ? reason.message : String(reason);
    },
  );
  return () => {
    stale = true;
  };
});

$effect(() => {
  if (!view || loadedPath !== path) return;
  const decorations = lineDecorations(view.state);
  const first = current && current.start <= view.state.doc.lines ? current.start : null;
  view.dispatch({
    effects: [
      setHighlight.of(decorations),
      ...(first ? [EditorView.scrollIntoView(view.state.doc.line(first).from, { y: "center" })] : []),
    ],
  });
});
</script>

<section aria-label="Code">
  <h2>{path}</h2>
  {#if error}
    <p role="alert" class="error">{error}</p>
  {/if}
  <div bind:this={host} hidden={error !== ""}></div>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  h2 {
    padding: var(--space) calc(var(--space) * 2);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 0.875rem;
    font-weight: 500;
  }

  div {
    flex: 1;
    min-height: 0;
  }

  .error {
    padding: calc(var(--space) * 2);
    color: var(--error);
  }
</style>

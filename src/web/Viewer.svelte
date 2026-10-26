<script lang="ts">
import { javascript } from "@codemirror/lang-javascript";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { fetchFile } from "./file.ts";
import type { LineRange } from "./highlight.ts";

let {
  path,
  token,
  current,
  previous,
}: { path: string; token: string; current: LineRange | null; previous: LineRange | null } =
  $props();

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

const highlightTheme = EditorView.baseTheme({
  ".cm-highlight-current": { backgroundColor: "rgba(255, 213, 0, 0.35)" },
  ".cm-highlight-previous": { backgroundColor: "rgba(128, 128, 128, 0.15)" },
});

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
      javascript({ jsx: true, typescript: true }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
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
  .error {
    color: #b00020;
  }
</style>

<script lang="ts">
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup, EditorView } from "codemirror";
import type { Selection } from "../shared/anchor.ts";
import { highlightExtensions, readOnly, showRanges } from "./editor.ts";
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
      highlightExtensions,
      EditorView.theme({ "&": { height: "100%" } }),
      javascript({ jsx: true, typescript: true }),
      readOnly,
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
  showRanges(view, current, previous);
});
</script>

<section class="code-view" aria-label="Code">
  <h2>{path}</h2>
  {#if error}
    <p role="alert" class="error">{error}</p>
  {/if}
  <div class="editor" bind:this={host} hidden={error !== ""}></div>
</section>

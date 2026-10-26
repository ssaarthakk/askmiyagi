<script lang="ts">
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { fetchFile } from "./file.ts";

let { path, token }: { path: string; token: string } = $props();

let host = $state<HTMLDivElement>();
let view: EditorView | undefined;
let error = $state("");

$effect(() => {
  if (!host) return;
  view = new EditorView({
    parent: host,
    extensions: [
      basicSetup,
      javascript({ jsx: true, typescript: true }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  return () => view?.destroy();
});

$effect(() => {
  let stale = false;
  fetchFile(path, token).then(
    (content) => {
      if (stale || !view) return;
      error = "";
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    },
    (reason: unknown) => {
      if (!stale) error = reason instanceof Error ? reason.message : String(reason);
    },
  );
  return () => {
    stale = true;
  };
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

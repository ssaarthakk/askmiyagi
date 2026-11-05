<script lang="ts">
import { javascript } from "@codemirror/lang-javascript";
import { MergeView } from "@codemirror/merge";
import { lineNumbers } from "@codemirror/view";
import { EditorView } from "codemirror";
import type { Selection } from "../shared/anchor.ts";
import type { ViewBase } from "../shared/diff-base.ts";
import { highlightExtensions, onSide, readOnly, showRanges } from "./editor.ts";
import { fetchFile } from "./file.ts";
import type { LineRange } from "./highlight.ts";
import { pickSelection } from "./selection.ts";

let {
  path,
  base,
  token,
  current,
  previous,
  onpick,
}: {
  path: string;
  base: ViewBase;
  token: string;
  current: LineRange | null;
  previous: LineRange | null;
  onpick: (selection: Selection) => void;
} = $props();

let host = $state<HTMLDivElement>();
let merged = $state.raw<MergeView>();
let notices = $state<string[]>([]);
let error = $state("");

function pane(label: string) {
  return [
    lineNumbers(),
    highlightExtensions,
    javascript({ jsx: true, typescript: true }),
    readOnly,
    EditorView.contentAttributes.of({ "aria-label": label }),
  ];
}

function content(result: PromiseSettledResult<string>, version: string) {
  if (result.status === "fulfilled") return { doc: result.value, notice: [] };
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { doc: "", notice: [`The ${version} version is not available: ${reason}`] };
}

$effect(() => {
  if (!host) return;
  const parent = host;
  let stale = false;
  let view: MergeView | undefined;
  error = "";
  notices = [];
  Promise.allSettled([fetchFile(path, token, base), fetchFile(path, token)]).then(
    ([before, after]) => {
      if (stale) return;
      const old = content(before, "old");
      const added = content(after, "new");
      if (before.status === "rejected" && after.status === "rejected") {
        error = old.notice.join("");
        return;
      }
      notices = [...old.notice, ...added.notice];
      view = new MergeView({
        parent,
        gutter: true,
        a: { doc: old.doc, extensions: pane("Old code") },
        b: {
          doc: added.doc,
          extensions: [
            pane("New code"),
            EditorView.domEventHandlers({
              mouseup: (_event, editor) => {
                const picked = pickSelection(editor.state, path);
                if (picked) onpick(picked);
              },
            }),
          ],
        },
      });
      merged = view;
    },
  );
  return () => {
    stale = true;
    view?.destroy();
    merged = undefined;
  };
});

$effect(() => {
  if (!merged) return;
  showRanges(merged.a, onSide(current, "old"), onSide(previous, "old"));
  showRanges(merged.b, onSide(current, "new"), onSide(previous, "new"));
});
</script>

<section class="code-view" aria-label="Code changes">
  <h2>{path}</h2>
  <p class="sides" aria-hidden="true"><span>Old</span><span>New</span></p>
  {#each notices as notice (notice)}
    <p role="status" class="notice">{notice}</p>
  {/each}
  {#if error}
    <p role="alert" class="error">{error}</p>
  {/if}
  <div class="editor" bind:this={host} hidden={error !== ""}></div>
</section>

<style>
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 0 calc(var(--space) * 2);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.75rem;
  }

  .notice {
    padding: var(--space) calc(var(--space) * 2);
    color: var(--muted);
    font-size: 0.875rem;
  }

  .editor :global(.cm-mergeView) {
    height: 100%;
    overflow: auto;
  }
</style>

<script lang="ts">
import type { Snippet } from "svelte";
import type { Selection } from "../shared/anchor.ts";
import DiffViewer from "./DiffViewer.svelte";
import type { Highlight } from "./highlight.ts";
import Viewer from "./Viewer.svelte";
import Welcome from "./Welcome.svelte";

let {
  highlight,
  staleNotice,
  reloads,
  token,
  welcome,
  projectName,
  onpick,
  onsuggest,
  children,
}: {
  highlight: Highlight | undefined;
  staleNotice: string;
  reloads: number;
  token: string;
  welcome: boolean;
  projectName: string;
  onpick: (selection: Selection) => void;
  onsuggest: (text: string) => void;
  children: Snippet;
} = $props();
</script>

<div class="code-pane">
  {#if staleNotice}
    <p role="status" class="notice">{staleNotice}</p>
  {/if}
  {#if highlight}
    {#key reloads}
      {#if highlight.base}
        <DiffViewer
          path={highlight.file}
          base={highlight.base}
          {token}
          current={highlight.current}
          previous={highlight.previous}
          {onpick}
        />
      {:else}
        <Viewer
          path={highlight.file}
          {token}
          current={highlight.current}
          previous={highlight.previous}
          {onpick}
        />
      {/if}
    {/key}
  {:else if welcome}
    <Welcome {projectName} {onsuggest} />
  {/if}
  {@render children()}
</div>

<style>
  .code-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .notice {
    padding: var(--space) calc(var(--space) * 2);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.875rem;
  }
</style>

<script lang="ts">
import type { PathItem, PathReplyItems } from "../shared/path.ts";

let {
  items,
  onask,
}: {
  items: PathReplyItems;
  onask: (item: PathItem) => void;
} = $props();

const next = $derived(items.find((item) => !item.done));
</script>

<section class="path" aria-label="Learning path">
  <h3>Learning path</h3>
  <ol>
    {#each items as item}
      <li>
        <button type="button" class="item" onclick={() => onask(item)}>
          <span role="img" aria-label={item.done ? "Done" : "Not done"}>{item.done ? "☑" : "☐"}</span>
          {item.concept}
        </button>
      </li>
    {/each}
  </ol>
  {#if next}
    <button type="button" class="primary" onclick={() => onask(next)}>Next</button>
  {:else}
    <p>You finished this path.</p>
  {/if}
</section>

<style>
  .path {
    display: grid;
    gap: var(--space);
    justify-items: start;
    padding: calc(var(--space) * 1.5);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  h3 {
    font-size: 1rem;
  }

  ol {
    list-style: none;
    display: grid;
    gap: calc(var(--space) / 2);
  }

  .item {
    border: none;
    background: transparent;
    text-align: left;
    padding: calc(var(--space) / 2) 0;
  }
</style>

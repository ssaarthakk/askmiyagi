<script lang="ts">
import type { PathItem, PathReplyItems } from "../shared/path.ts";
import PathCard from "./PathCard.svelte";

let {
  projectName,
  onsuggest,
  reviewsDue,
  onreview,
  pathItems,
  onpathask,
}: {
  projectName: string;
  onsuggest: (text: string) => void;
  reviewsDue: number;
  onreview: () => void;
  pathItems: PathReplyItems | undefined;
  onpathask: (item: PathItem) => void;
} = $props();

const suggestions = [
  "Where does this app start?",
  "What are the main parts of this project?",
  "Walk me through the most important flow",
];
</script>

<section class="welcome" aria-label="Welcome">
  <h1>{projectName}</h1>
  <p>Miyagi explains this code out loud and highlights what it talks about.</p>
  {#if reviewsDue > 0}
    <p class="reviews">
      {reviewsDue} {reviewsDue === 1 ? "review" : "reviews"} due
      <button type="button" onclick={onreview}>Start review</button>
    </p>
  {/if}
  {#if pathItems}
    <PathCard items={pathItems} onask={onpathask} />
  {/if}
  <div class="suggestions">
    {#each suggestions as suggestion}
      <button type="button" onclick={() => onsuggest(suggestion)}>{suggestion}</button>
    {/each}
  </div>
</section>

<style>
  .welcome {
    margin: auto;
    max-width: 520px;
    padding: calc(var(--space) * 3);
    display: grid;
    gap: calc(var(--space) * 2);
    justify-items: start;
  }

  .welcome p {
    color: var(--muted);
  }

  .welcome .reviews {
    display: flex;
    align-items: center;
    gap: var(--space);
  }

  .suggestions {
    display: grid;
    gap: var(--space);
    justify-items: start;
  }
</style>

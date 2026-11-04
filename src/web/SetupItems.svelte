<script lang="ts">
import type { SetupView } from "./setup.svelte.ts";

let {
  setup,
  onanswer,
  onskip,
}: {
  setup: SetupView;
  onanswer: (value: string, label: string) => void;
  onskip: () => void;
} = $props();
</script>

{#each setup.shown as item}
  <li class="tutor">{item.question}</li>
  <li class="question">{item.answer}</li>
{/each}
{#if setup.current}
  <li class="tutor">{setup.current.text}</li>
  {#if setup.current.choices.length === 0 && setup.chosen}
    <li class="note">Now: {setup.chosen}</li>
  {/if}
  <li class="choices">
    {#each setup.current.choices as choice}
      <button
        type="button"
        aria-pressed={setup.chosen === null ? undefined : setup.chosen === choice.value}
        onclick={() => onanswer(choice.value, choice.label)}
      >{choice.label}</button>
    {/each}
    <button type="button" onclick={onskip}>Skip</button>
  </li>
{:else if setup.done}
  <li class="tutor">Saved. Press Profile any time to change it.</li>
{/if}
{#if setup.problem}
  <li class="note error">{setup.problem}</li>
{/if}

<style>
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space);
  }
</style>

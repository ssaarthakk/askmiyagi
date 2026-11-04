<script lang="ts">
import { type Intent, intents } from "../shared/intent.ts";

const intentLabels: Record<Intent, string> = {
  interview: "Interview prep",
  onboarding: "Onboarding",
  contributing: "Contributing",
  debugging: "Debugging",
};

let {
  intent,
  editable,
  choice,
  onintent,
}: {
  intent: Intent;
  editable: boolean;
  choice: Intent | undefined;
  onintent: (chosen: Intent | undefined) => void;
} = $props();

function pick(event: Event & { currentTarget: HTMLSelectElement }) {
  const picked = event.currentTarget.value;
  onintent(intents.find((each) => each === picked));
}
</script>

<li class="intent">
  {#if editable}
    <select aria-label="Intent" value={choice ?? "auto"} onchange={pick}>
      <option value="auto">{choice ? "Auto" : `Auto: ${intentLabels[intent]}`}</option>
      {#each intents as each}
        <option value={each}>{intentLabels[each]}</option>
      {/each}
    </select>
  {:else}
    {intentLabels[intent]}
  {/if}
</li>

<style>
  .intent {
    align-self: flex-end;
    padding: 0 var(--space);
    background: var(--accent-soft);
    border-radius: var(--radius);
    font-size: 0.8125rem;
  }

  select {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }
</style>

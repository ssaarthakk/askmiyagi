<script lang="ts">
import type { DiffBase, DiffRequest } from "../shared/diff-base.ts";

let { asking, onexplain }: { asking: boolean; onexplain: (question: string, diff: DiffRequest) => void } = $props();

const choices: { base: DiffBase; label: string }[] = [
  { base: "uncommitted", label: "Uncommitted changes" },
  { base: "branch", label: "Since the branch started" },
  { base: "snapshot", label: "Since my snapshot" },
];

let base = $state<DiffBase>("uncommitted");
let why = $state("");

function explain() {
  const label = choices.find((choice) => choice.base === base)?.label ?? base;
  const note = why.trim();
  onexplain(`Explain my diff (${label.toLowerCase()})`, { base, ...(note && { why: note }) });
}
</script>

<details>
  <summary>Explain my diff</summary>
  <div class="fields">
    <label>
      Diff base
      <select bind:value={base}>
        {#each choices as choice (choice.base)}
          <option value={choice.base}>{choice.label}</option>
        {/each}
      </select>
    </label>
    <label>
      Why (optional)
      <textarea
        rows="2"
        placeholder="A PR description or a note on why you made the change"
        maxlength="2000"
        bind:value={why}
      ></textarea>
    </label>
    <button type="button" class="primary" disabled={asking} onclick={explain}>Explain this diff</button>
  </div>
</details>

<style>
  details {
    padding: var(--space) calc(var(--space) * 2);
    border-top: 1px solid var(--border);
  }

  summary {
    cursor: pointer;
  }

  .fields {
    display: grid;
    gap: var(--space);
    padding-top: var(--space);
  }

  label {
    display: grid;
    gap: calc(var(--space) / 2);
    color: var(--muted);
    font-size: 0.875rem;
  }

  button {
    justify-self: end;
  }
</style>

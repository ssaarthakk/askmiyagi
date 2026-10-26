<script lang="ts">
import type { PlayerStep, Position } from "./player.ts";

let {
  steps,
  position,
  previous,
  next,
  onselect,
}: {
  steps: PlayerStep[];
  position: Position | undefined;
  previous: Position | undefined;
  next: Position | undefined;
  onselect: (position: Position) => void;
} = $props();
</script>

<section aria-label="Tour">
  <div>
    <button type="button" disabled={!previous} onclick={() => previous && onselect(previous)}>
      Previous
    </button>
    <button type="button" disabled={!next} onclick={() => next && onselect(next)}>Next</button>
  </div>
  <ol>
    {#each steps as { step }, stepIndex}
      <li>
        <h2>{step.title}</h2>
        <ol>
          {#each step.narration as segment, segmentIndex}
            {@const current = position?.step === stepIndex && position.segment === segmentIndex}
            <li>
              <button
                type="button"
                class:current
                aria-current={current ? "true" : undefined}
                onclick={() => onselect({ step: stepIndex, segment: segmentIndex })}
              >
                {segment.text}
              </button>
            </li>
          {/each}
        </ol>
      </li>
    {/each}
  </ol>
</section>

<style>
  .current {
    font-weight: bold;
    background: rgba(255, 213, 0, 0.35);
  }
</style>

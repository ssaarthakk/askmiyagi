<script lang="ts">
import type { PlayerStep, Position } from "./player.ts";

let {
  steps,
  position,
  previous,
  next,
  voiceOn,
  playing,
  canSpeak,
  onselect,
  onvoice,
}: {
  steps: PlayerStep[];
  position: Position | undefined;
  previous: Position | undefined;
  next: Position | undefined;
  voiceOn: boolean;
  playing: boolean;
  canSpeak: boolean;
  onselect: (position: Position) => void;
  onvoice: () => void;
} = $props();
</script>

<section aria-label="Tour">
  {#if !voiceOn}
    <div class="controls">
      <button type="button" disabled={!previous} onclick={() => previous && onselect(previous)}>
        Previous
      </button>
      <button type="button" disabled={!next} onclick={() => next && onselect(next)}>Next</button>
      <button type="button" aria-pressed="false" disabled={!canSpeak} onclick={onvoice}>
        Voice
      </button>
    </div>
  {/if}
  <ol class="steps">
    {#each steps as { step }, stepIndex}
      <li>
        <h3>{step.title}</h3>
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
                {playing && current ? `Segment ${segmentIndex + 1}` : segment.text}
              </button>
            </li>
          {/each}
        </ol>
      </li>
    {/each}
  </ol>
</section>

<style>
  .controls {
    display: flex;
    gap: var(--space);
    margin-bottom: calc(var(--space) * 1.5);
  }

  .steps {
    display: grid;
    gap: calc(var(--space) * 1.5);
  }

  h3 {
    font-size: 0.875rem;
    margin-bottom: calc(var(--space) / 2);
  }

  ol ol {
    display: grid;
    gap: calc(var(--space) / 2);
  }

  ol ol button {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
    padding: calc(var(--space) / 2) var(--space);
    text-align: left;
    width: 100%;
  }

  ol ol button:hover:not(:disabled) {
    border-color: var(--border);
  }

  ol ol button.current {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--text);
  }
</style>

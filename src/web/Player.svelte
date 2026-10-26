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
  onpause,
  onresume,
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
  onpause: () => void;
  onresume: () => void;
  onvoice: () => void;
} = $props();
</script>

<section aria-label="Tour">
  <div>
    <button type="button" disabled={!previous} onclick={() => previous && onselect(previous)}>
      Previous
    </button>
    <button type="button" disabled={!next} onclick={() => next && onselect(next)}>Next</button>
    <button type="button" aria-pressed={voiceOn} disabled={!canSpeak} onclick={onvoice}>
      Voice
    </button>
    {#if voiceOn}
      <button type="button" onclick={playing ? onpause : onresume}>
        {playing ? "Pause" : "Resume"}
      </button>
    {/if}
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
  [aria-pressed="true"],
  .current {
    font-weight: bold;
    background: rgba(255, 213, 0, 0.35);
  }
</style>

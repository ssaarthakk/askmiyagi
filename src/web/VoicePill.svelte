<script lang="ts">
import type { Position } from "./player.ts";

let {
  title,
  previous,
  next,
  playing,
  onselect,
  onpause,
  onresume,
  onvoice,
}: {
  title: string;
  previous: Position | undefined;
  next: Position | undefined;
  playing: boolean;
  onselect: (position: Position) => void;
  onpause: () => void;
  onresume: () => void;
  onvoice: () => void;
} = $props();
</script>

<section class="voice-pill" aria-label="Voice controls">
  <span class="level-bars" class:speaking={playing} aria-hidden="true">
    <span></span><span></span><span></span><span></span>
  </span>
  <span class="title">{title}</span>
  <button type="button" disabled={!previous} onclick={() => previous && onselect(previous)}>
    Previous
  </button>
  <button type="button" class="primary main" onclick={playing ? onpause : onresume}>
    {playing ? "Pause" : "Resume"}
  </button>
  <button type="button" disabled={!next} onclick={() => next && onselect(next)}>Next</button>
  <button type="button" aria-pressed="true" onclick={onvoice}>Voice</button>
</section>

<style>
  .voice-pill {
    position: absolute;
    bottom: calc(var(--space) * 3);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space);
    max-width: calc(100% - var(--space) * 4);
    box-sizing: border-box;
    padding: var(--space) calc(var(--space) * 2);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  button {
    border-radius: 999px;
    font-size: 0.875rem;
  }

  .main {
    font-size: 1rem;
    padding: var(--space) calc(var(--space) * 3);
  }

  .level-bars {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 20px;
  }

  .level-bars span {
    width: 3px;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transform: scaleY(0.3);
    animation: level 700ms ease-in-out infinite alternate;
    animation-play-state: paused;
  }

  .level-bars span:nth-child(2) {
    animation-delay: -200ms;
  }

  .level-bars span:nth-child(3) {
    animation-delay: -400ms;
  }

  .level-bars span:nth-child(4) {
    animation-delay: -100ms;
  }

  .speaking span {
    animation-play-state: running;
  }

  @keyframes level {
    to {
      transform: scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .level-bars span {
      animation: none;
    }
  }
</style>

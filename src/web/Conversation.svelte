<script lang="ts" module>
export type Note = { kind: "ack" | "progress" | "error"; text: string };
export type Turn = { question: string; notes: Note[]; titles: string[]; check: string | undefined };
</script>

<script lang="ts">
import type { Snippet } from "svelte";

let {
  turns,
  tourVisible,
  tour,
  question = $bindable(),
  microphoneButton = $bindable(),
  selectionLabel,
  elevenLabs,
  voiceNotice,
  micNotice,
  recording,
  asking,
  onsend,
  onremoveselection,
  onmicdown,
  onmicup,
}: {
  turns: Turn[];
  tourVisible: boolean;
  tour: Snippet;
  question: string;
  microphoneButton: HTMLButtonElement | undefined;
  selectionLabel: string | undefined;
  elevenLabs: boolean;
  voiceNotice: string;
  micNotice: string;
  recording: boolean;
  asking: boolean;
  onsend: () => void;
  onremoveselection: () => void;
  onmicdown: (event: PointerEvent) => void;
  onmicup: () => void;
} = $props();

let list = $state<HTMLUListElement>();

$effect(() => {
  if (!list) return;
  const element = list;
  const observer = new MutationObserver(() => {
    element.scrollTop = element.scrollHeight;
  });
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
});

function submit(event: SubmitEvent) {
  event.preventDefault();
  onsend();
}

function keydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  onsend();
}
</script>

<aside aria-label="Conversation panel">
  <header>
    <h2>Miyagi</h2>
    {#if elevenLabs}
      <p class="muted">Voice by ElevenLabs</p>
    {/if}
  </header>
  <p role="status" class="muted notice">{voiceNotice}</p>
  <ul bind:this={list} aria-label="Conversation" aria-live="polite">
    {#each turns as turn, index}
      {#if turn.question}
        <li class="question">{turn.question}</li>
      {/if}
      {#each turn.notes as note}
        <li class="note {note.kind}">{note.text}</li>
      {/each}
      {#if index === turns.length - 1}
        {#if tourVisible}
          <li class="card">{@render tour()}</li>
        {/if}
      {:else if turn.titles.length > 0}
        <li class="card muted">{turn.titles.join(" / ")}</li>
      {/if}
      {#if turn.check}
        <li class="tutor">{turn.check}</li>
      {/if}
    {/each}
  </ul>
  <form onsubmit={submit}>
    {#if selectionLabel}
      <p class="chip">
        <span>{selectionLabel}</span>
        <button type="button" aria-label="Remove selection" onclick={onremoveselection}>×</button>
      </p>
    {/if}
    <p role="status" class="muted">{micNotice}</p>
    <textarea
      aria-label="Question"
      placeholder="Ask about the code"
      rows="2"
      bind:value={question}
      disabled={asking}
      autocomplete="off"
      onkeydown={keydown}
    ></textarea>
    <div class="actions">
      {#if elevenLabs}
        <button
          type="button"
          bind:this={microphoneButton}
          aria-pressed={recording}
          disabled={asking}
          onpointerdown={onmicdown}
          onpointerup={onmicup}
          onpointercancel={onmicup}
        >Hold to talk</button>
      {/if}
      <button type="submit" class="primary" disabled={asking}>Send</button>
    </div>
  </form>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-left: 1px solid var(--border);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: calc(var(--space) * 2);
    border-bottom: 1px solid var(--border);
  }

  h2 {
    font-size: 1.125rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.875rem;
  }

  [role="status"]:empty {
    display: none;
  }

  .notice {
    padding: var(--space) calc(var(--space) * 2) 0;
  }

  ul {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space);
    padding: calc(var(--space) * 2);
  }

  .question,
  .tutor {
    max-width: 85%;
    padding: var(--space) calc(var(--space) * 1.5);
    border-radius: var(--radius);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .question {
    align-self: flex-end;
    background: var(--accent);
    color: var(--bg);
  }

  .tutor {
    align-self: flex-start;
  }

  .tutor,
  .card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .note {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .note.error {
    color: var(--error);
  }

  .card {
    padding: calc(var(--space) * 1.5);
  }

  form {
    padding: calc(var(--space) * 2);
    border-top: 1px solid var(--border);
    display: grid;
    gap: var(--space);
  }

  .chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space);
    padding: calc(var(--space) / 2) var(--space);
    background: var(--accent-soft);
    border-radius: var(--radius);
    font-family: var(--mono);
    font-size: 0.8125rem;
  }

  .chip button {
    padding: 0 var(--space);
    border: none;
    background: transparent;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space);
  }

  @media (max-width: 899px) {
    aside {
      order: -1;
      border-left: none;
      border-bottom: 1px solid var(--border);
    }
  }
</style>

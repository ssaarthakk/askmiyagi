<script lang="ts" module>
export type Note = { kind: "ack" | "progress" | "error" | "tutor" | "learner"; text: string };
export type Turn = {
  question: string;
  notes: Note[];
  titles: string[];
  check: string | undefined;
  intent: Intent | undefined;
};
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import type { DiffRequest } from "../shared/diff-base.ts";
import type { Intent } from "../shared/intent.ts";
import type { PathItem, PathReplyItems } from "../shared/path.ts";
import type { Profile } from "../shared/profile.ts";
import DiffForm from "./DiffForm.svelte";
import IntentTag from "./IntentTag.svelte";
import PathCard from "./PathCard.svelte";
import type { PrimmView } from "./primm.svelte.ts";
import SetupItems from "./SetupItems.svelte";
import type { SetupView } from "./setup.svelte.ts";

let {
  turns,
  tourVisible,
  tour,
  question = $bindable(),
  microphoneButton = $bindable(),
  selectionLabel,
  elevenLabs,
  voiceNotice,
  profileNotice,
  setup,
  onanswer,
  onskip,
  onprofile,
  teaching,
  onmode,
  intentChoice,
  onintent,
  micNotice,
  recording,
  handsFree,
  asking,
  onsend,
  onexplaindiff,
  onremoveselection,
  onmicdown,
  onmicup,
  ontogglehandsfree,
  primm,
  onprimmskip,
  explainConcept,
  onexplainskip,
  reviewOffer,
  onreviewstart,
  onreviewskip,
  pathItems,
  planning,
  onplan,
  onpathask,
}: {
  turns: Turn[];
  tourVisible: boolean;
  tour: Snippet;
  question: string;
  microphoneButton: HTMLButtonElement | undefined;
  selectionLabel: string | undefined;
  elevenLabs: boolean;
  voiceNotice: string;
  profileNotice: string;
  setup: SetupView | undefined;
  onanswer: (value: string, label: string) => void;
  onskip: () => void;
  onprofile: () => void;
  teaching: boolean | undefined;
  onmode: (mode: Profile["mode"]) => void;
  intentChoice: Intent | undefined;
  onintent: (chosen: Intent | undefined) => void;
  micNotice: string;
  recording: boolean;
  handsFree: boolean;
  asking: boolean;
  onsend: () => void;
  onexplaindiff: (question: string, diff: DiffRequest) => void;
  onremoveselection: () => void;
  onmicdown: (event: PointerEvent) => void;
  onmicup: () => void;
  ontogglehandsfree: () => void;
  primm: PrimmView | undefined;
  onprimmskip: () => void;
  explainConcept: string | undefined;
  onexplainskip: () => void;
  reviewOffer: string | undefined;
  onreviewstart: () => void;
  onreviewskip: () => void;
  pathItems: PathReplyItems | undefined;
  planning: boolean;
  onplan: () => void;
  onpathask: (item: PathItem) => void;
} = $props();

const predicting = $derived(primm?.phase === "predict");

let list = $state<HTMLUListElement>();
const lastIntentTurn = $derived(turns.findLastIndex((turn) => turn.intent !== undefined));

$effect(() => {
  if (!list) return;
  const element = list;
  const observer = new MutationObserver(() => {
    element.scrollTop = element.scrollHeight;
  });
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
});

function noteClass(note: Note) {
  if (note.kind === "tutor") return "tutor";
  return note.kind === "learner" ? "question" : `note ${note.kind}`;
}

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
    <div class="actions">
      <button
        type="button"
        role="switch"
        aria-checked={teaching === true}
        disabled={teaching === undefined}
        onclick={() => onmode(teaching ? "answer" : "teach")}
      >
        Teach mode
      </button>
      <button type="button" onclick={onprofile}>Profile</button>
      <button type="button" disabled={teaching === undefined || planning || asking} onclick={onplan}>
        {planning ? "Planning…" : "Plan a learning path"}
      </button>
    </div>
  </header>
  <p role="status" class="muted notice">{voiceNotice}</p>
  <p role="status" class="muted notice">{profileNotice}</p>
  {#if pathItems}
    <div class="path-card"><PathCard items={pathItems} onask={onpathask} /></div>
  {/if}
  <ul class="conversation" bind:this={list} aria-label="Conversation" aria-live="polite">
    {#if setup && setup.after === 0}
      <SetupItems {setup} {onanswer} {onskip} />
    {/if}
    {#each turns as turn, index}
      {#if turn.question}
        <li class="question">{turn.question}</li>
      {/if}
      {#if turn.intent}
        <IntentTag
          intent={turn.intent}
          editable={index === lastIntentTurn}
          choice={intentChoice}
          {onintent}
        />
      {/if}
      {#each turn.notes as note}
        <li class={noteClass(note)}>{note.text}</li>
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
      {#if setup && setup.after === index + 1}
        <SetupItems {setup} {onanswer} {onskip} />
      {/if}
    {/each}
    {#if reviewOffer}
      <li class="tutor">A review is due: {reviewOffer}. Want to try it now?</li>
      <li class="offer">
        <button type="button" onclick={onreviewstart}>Start review</button>
        <button type="button" onclick={onreviewskip}>Skip review</button>
      </li>
    {/if}
  </ul>
  <DiffForm {asking} onexplain={onexplaindiff} />
  <form onsubmit={submit}>
    {#if selectionLabel}
      <p class="chip">
        <span>{selectionLabel}</span>
        <button type="button" aria-label="Remove selection" onclick={onremoveselection}>×</button>
      </p>
    {/if}
    {#if primm}
      <p class="chip">
        <span>{primm.phase === "predict" ? "Predict" : "Investigate"}: {primm.prompt}</span>
        <button type="button" onclick={onprimmskip}>Skip</button>
      </p>
    {/if}
    {#if explainConcept && !primm}
      <p class="chip">
        <span>Explain back: {explainConcept}</span>
        <button type="button" onclick={onexplainskip}>Skip</button>
      </p>
    {/if}
    <p role="status" class="muted">{micNotice}</p>
    <textarea
      aria-label="Question"
      placeholder={predicting
        ? "Type your prediction"
        : explainConcept
          ? "Explain it in your own words"
          : "Ask about the code"}
      rows="2"
      bind:value={question}
      disabled={asking && !predicting}
      autocomplete="off"
      onkeydown={keydown}
    ></textarea>
    <div class="actions">
      <button
        type="button"
        bind:this={microphoneButton}
        aria-pressed={recording}
        onpointerdown={onmicdown}
        onpointerup={onmicup}
        onpointercancel={onmicup}
      >Hold to talk</button>
      <button type="button" aria-pressed={handsFree} onclick={ontogglehandsfree}>Hands-free</button>
      <button type="submit" class="primary" disabled={asking && !predicting}>Send</button>
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

  .path-card {
    padding: var(--space) calc(var(--space) * 2) 0;
    max-height: 40%;
    overflow-y: auto;
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

  .card {
    padding: calc(var(--space) * 1.5);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .offer {
    display: flex;
    gap: var(--space);
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

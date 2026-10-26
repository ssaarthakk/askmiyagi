<script lang="ts">
import { ask } from "./ask.ts";
import { type Highlight, moveHighlight } from "./highlight.ts";
import Player from "./Player.svelte";
import { anchorTarget, firstPosition, neighbour, type PlayerStep, type Position } from "./player.ts";
import Viewer from "./Viewer.svelte";

const token = document.querySelector<HTMLMetaElement>('meta[name="miyagi-token"]')?.content ?? "";

let question = $state("");
let asking = $state(false);
let highlight = $state<Highlight>();
let steps = $state<PlayerStep[]>([]);
let position = $state<Position>();
const previous = $derived(position && neighbour(steps, position, -1));
const next = $derived(position && neighbour(steps, position, 1));

function select(chosen: Position) {
  position = chosen;
  const entry = steps[chosen.step];
  const target = entry && anchorTarget(entry, chosen.segment);
  if (target) highlight = moveHighlight(highlight, target.file, target.range);
}

function selectFirst() {
  const first = firstPosition(steps);
  if (first) select(first);
}

let messages = $state<{ kind: "ack" | "progress" | "error"; text: string }[]>([]);

async function submit(event: SubmitEvent) {
  event.preventDefault();
  const text = question.trim();
  if (!text || asking) return;
  asking = true;
  messages = [];
  steps = [];
  position = undefined;
  highlight = undefined;
  try {
    await ask(text, token, (askEvent) => {
      if (askEvent.type === "ack" || askEvent.type === "progress") {
        messages.push({ kind: askEvent.type, text: askEvent.text });
      } else if (askEvent.type === "step") {
        steps.push({ step: askEvent.step, ranges: askEvent.ranges });
        if (!position) selectFirst();
      } else if (askEvent.type === "tour") {
        steps = askEvent.tour.steps.map((step, index) => ({
          step,
          ranges: askEvent.ranges[index] ?? [],
        }));
        if (!position || !steps[position.step]?.step.narration[position.segment]) {
          selectFirst();
        }
      } else if (askEvent.type === "error") {
        messages.push({ kind: "error", text: askEvent.message });
      }
    });
  } catch (error) {
    messages.push({ kind: "error", text: error instanceof Error ? error.message : String(error) });
  } finally {
    asking = false;
  }
}
</script>

<main>
  <h1>Miyagi</h1>
  <form onsubmit={submit}>
    <label>
      Question
      <input bind:value={question} disabled={asking} autocomplete="off" />
    </label>
    <button type="submit" disabled={asking}>Ask</button>
  </form>
  <ul aria-live="polite">
    {#each messages as message}
      <li class={message.kind}>{message.text}</li>
    {/each}
  </ul>
  {#if steps.length > 0}
    <Player {steps} {position} {previous} {next} onselect={select} />
  {/if}
  {#if highlight}
    <Viewer
      path={highlight.file}
      {token}
      current={highlight.current}
      previous={highlight.previous}
    />
  {/if}
</main>

<style>
  :global(:focus-visible) {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .error {
    color: #b00020;
  }

  .progress {
    opacity: 0.7;
  }
</style>

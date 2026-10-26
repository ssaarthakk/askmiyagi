<script lang="ts">
import { ask } from "./ask.ts";
import Viewer from "./Viewer.svelte";

const token = document.querySelector<HTMLMetaElement>('meta[name="miyagi-token"]')?.content ?? "";

let question = $state("");
let asking = $state(false);
let file = $state<string>();
let messages = $state<{ kind: "ack" | "progress" | "error"; text: string }[]>([]);

async function submit(event: SubmitEvent) {
  event.preventDefault();
  const text = question.trim();
  if (!text || asking) return;
  asking = true;
  messages = [];
  file = undefined;
  try {
    await ask(text, token, (askEvent) => {
      if (askEvent.type === "ack" || askEvent.type === "progress") {
        messages.push({ kind: askEvent.type, text: askEvent.text });
      } else if (askEvent.type === "step") {
        file = askEvent.step.anchors[0]?.file ?? file;
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
  {#if file}
    <Viewer path={file} {token} />
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

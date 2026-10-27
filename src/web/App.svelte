<script lang="ts">
import type { Selection } from "../shared/anchor.ts";
import { createAnnouncer, spokenProgress } from "./announcer.ts";
import { ask } from "./ask.ts";
import { type Highlight, moveHighlight } from "./highlight.ts";
import Player from "./Player.svelte";
import { createPlayback } from "./playback.ts";
import { anchorTarget, firstPosition, neighbour, type PlayerStep, type Position } from "./player.ts";
import { chooseSpeaker, localVoices, noLocalVoice, type Speaker } from "./speaker.ts";
import Viewer from "./Viewer.svelte";

const token = document.querySelector<HTMLMetaElement>('meta[name="miyagi-token"]')?.content ?? "";

const voice = document.querySelector<HTMLMetaElement>('meta[name="miyagi-voice"]')?.content ?? "browser";
const injectedSpeaker = (window as { __MIYAGI_SPEAKER__?: Speaker }).__MIYAGI_SPEAKER__;
let voiceNotice = $state("");
const speaker =
  injectedSpeaker ??
  (typeof speechSynthesis === "undefined"
    ? undefined
    : chooseSpeaker(voice, token, (text) => {
        voiceNotice = text;
      }));
let voiceOn = $state(speaker !== undefined);
let playing = $state(false);
let caughtUp = false;
let interrupted: Position | undefined;

function textMode(notice: string) {
  voiceNotice = notice;
  voiceOn = false;
  pause();
  const at = position ? undefined : (interrupted ?? firstPosition(steps));
  if (at) select(at);
}

let question = $state("");
let selection = $state<Selection>();
const selectionLabel = $derived(
  selection && `${selection.file}:${selection.start}${selection.end > selection.start ? `-${selection.end}` : ""}`,
);
let asking = $state(false);
let highlight = $state<Highlight>();
let steps = $state<PlayerStep[]>([]);
let position = $state<Position>();
let tourStarted = false;
const previous = $derived(position && neighbour(steps, position, -1));
const next = $derived(position && neighbour(steps, position, 1));

function select(chosen: Position) {
  position = chosen;
  const entry = steps[chosen.step];
  const target = entry && anchorTarget(entry, chosen.segment);
  if (target) highlight = moveHighlight(highlight, target.file, target.range);
}

const announcer = speaker && createAnnouncer(speaker, (error) => textMode(error.message));
function announce(text: string) {
  if (voiceOn && steps.length === 0) announcer?.say(text);
}

const playback =
  speaker &&
  createPlayback(speaker, {
    steps: () => steps,
    ready: () => announcer?.finished() ?? Promise.resolve(),
    onStart: select,
    onEnd: (error) => {
      playing = false;
      caughtUp = !error;
      if (error) textMode(error.message);
    },
  });

function go(chosen: Position) {
  tourStarted = true;
  caughtUp = false;
  interrupted = undefined;
  if (voiceOn && playback) {
    playing = true;
    playback.play(chosen);
  } else select(chosen);
}

function selectFirst() {
  const first = firstPosition(steps);
  if (first) go(first);
}

function pause() {
  caughtUp = false;
  interrupted = playback?.stop() ?? interrupted;
  announcer?.stop();
  playing = false;
}

function resume() {
  const at = interrupted ?? position;
  if (at) go(at);
  else selectFirst();
}

function toggleVoice() {
  pause();
  voiceOn = !voiceOn;
}

if (!speaker) {
  textMode(noLocalVoice);
} else if (!injectedSpeaker && voice === "browser") {
  void localVoices(speechSynthesis).then((voices) => {
    if (voices.length === 0) textMode(noLocalVoice);
  });
}

let messages = $state<{ kind: "ack" | "progress" | "error"; text: string }[]>([]);

async function submit(event: SubmitEvent) {
  event.preventDefault();
  const text = question.trim();
  if (!text || asking) return;
  asking = true;
  const attached = selection;
  selection = undefined;
  pause();
  interrupted = undefined;
  messages = [];
  steps = [];
  position = undefined;
  tourStarted = false;
  highlight = undefined;
  try {
    await ask(text, token, attached, (askEvent) => {
      if (askEvent.type === "ack" || askEvent.type === "progress") {
        messages.push({ kind: askEvent.type, text: askEvent.text });
        announce(askEvent.type === "progress" ? spokenProgress(askEvent.text) : askEvent.text);
      } else if (askEvent.type === "step") {
        announcer?.dropWaiting();
        steps.push({ step: askEvent.step, ranges: askEvent.ranges });
        const resumeAt = caughtUp && position && neighbour(steps, position, 1);
        if (resumeAt) go(resumeAt);
        else if (!tourStarted) selectFirst();
      } else if (askEvent.type === "tour") {
        steps = askEvent.tour.steps.map((step, index) => ({
          step,
          ranges: askEvent.ranges[index] ?? [],
        }));
        if (!tourStarted || (position && !steps[position.step]?.step.narration[position.segment])) {
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
  {#if selection}
    <p>
      <span>{selectionLabel}</span>
      <button type="button" onclick={() => (selection = undefined)}>Remove selection</button>
    </p>
  {/if}
  {#if voice === "elevenlabs"}
    <p>Voice by ElevenLabs</p>
  {/if}
  <p role="status">{voiceNotice}</p>
  <ul aria-live="polite">
    {#each messages as message}
      <li class={message.kind}>{message.text}</li>
    {/each}
  </ul>
  {#if steps.length > 0}
    <Player
      {steps}
      {position}
      {previous}
      {next}
      {voiceOn}
      {playing}
      canSpeak={speaker !== undefined}
      onselect={go}
      onpause={pause}
      onresume={resume}
      onvoice={toggleVoice}
    />
  {/if}
  {#if highlight}
    <Viewer
      path={highlight.file}
      {token}
      current={highlight.current}
      previous={highlight.previous}
      onpick={(picked) => (selection = picked)}
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

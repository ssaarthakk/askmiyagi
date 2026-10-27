<script lang="ts">
import type { Selection } from "../shared/anchor.ts";
import { createAnnouncer, spokenProgress } from "./announcer.ts";
import { ask } from "./ask.ts";
import Conversation, { type Note, type Turn } from "./Conversation.svelte";
import { type Highlight, moveHighlight } from "./highlight.ts";
import Player from "./Player.svelte";
import { createPlayback } from "./playback.ts";
import { anchorTarget, firstPosition, neighbour, type PlayerStep, type Position } from "./player.ts";
import { chooseSpeaker, localVoices, noLocalVoice, type Speaker } from "./speaker.ts";
import { createTalk } from "./talk.svelte.ts";
import Viewer from "./Viewer.svelte";
import VoicePill from "./VoicePill.svelte";
import Welcome from "./Welcome.svelte";

const token = document.querySelector<HTMLMetaElement>('meta[name="miyagi-token"]')?.content ?? "";

const projectName = decodeURIComponent(
  document.querySelector<HTMLMetaElement>('meta[name="miyagi-project"]')?.content ?? "",
);
const voice = document.querySelector<HTMLMetaElement>('meta[name="miyagi-voice"]')?.content ?? "browser";
const elevenLabs = voice === "elevenlabs";
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
let checkQuestion = $state<string>();
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
    closing: () => checkQuestion,
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

let turns = $state<Turn[]>([]);

function note(kind: Note["kind"], text: string) {
  turns.at(-1)?.notes.push({ kind, text });
}

function askText(text: string) {
  question = text;
  return sendQuestion();
}

async function sendQuestion() {
  const text = question.trim();
  if (!text || asking) return;
  asking = true;
  const attached = selection;
  selection = undefined;
  pause();
  interrupted = undefined;
  const finished = turns.at(-1);
  if (finished) finished.titles = steps.map((entry) => entry.step.title);
  turns.push({ question: text, notes: [], titles: [], check: undefined });
  steps = [];
  checkQuestion = undefined;
  position = undefined;
  tourStarted = false;
  highlight = undefined;
  try {
    await ask(text, token, attached, (askEvent) => {
      if (askEvent.type === "ack" || askEvent.type === "progress") {
        note(askEvent.type, askEvent.text);
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
        checkQuestion = askEvent.tour.checkQuestion;
        const current = turns.at(-1);
        if (current) current.check = checkQuestion;
        if (caughtUp && checkQuestion && playback) {
          caughtUp = false;
          playing = true;
          void playback.play(undefined);
        }
      } else if (askEvent.type === "error") {
        note("error", askEvent.message);
      }
    });
  } catch (error) {
    note("error", error instanceof Error ? error.message : String(error));
  } finally {
    asking = false;
  }
}

let microphoneButton = $state<HTMLButtonElement>();

const talk = createTalk({
  enabled: elevenLabs,
  token,
  busy: () => asking,
  button: () => microphoneButton,
  onstart: pause,
  onquestion: askText,
});
</script>

<svelte:window onkeydown={talk.keydown} onkeyup={talk.keyup} onblur={talk.stop} />

<main class="app">
  <div class="code-pane">
    {#if highlight}
      <Viewer
        path={highlight.file}
        {token}
        current={highlight.current}
        previous={highlight.previous}
        onpick={(picked) => (selection = picked)}
      />
    {:else if turns.length === 0}
      <Welcome {projectName} onsuggest={askText} />
    {/if}
    {#if voiceOn && steps.length > 0}
      <VoicePill
        title={position ? (steps[position.step]?.step.title ?? "") : ""}
        {previous}
        {next}
        {playing}
        onselect={go}
        onpause={pause}
        onresume={resume}
        onvoice={toggleVoice}
      />
    {/if}
  </div>
  <Conversation
    {turns}
    tourVisible={steps.length > 0}
    {tour}
    bind:question
    bind:microphoneButton
    {selectionLabel}
    {elevenLabs}
    {voiceNotice}
    micNotice={talk.notice}
    recording={talk.recording}
    {asking}
    onsend={sendQuestion}
    onremoveselection={() => (selection = undefined)}
    onmicdown={talk.pointerdown}
    onmicup={talk.stop}
  />
</main>

{#snippet tour()}
  <Player
    {steps}
    {position}
    {previous}
    {next}
    {voiceOn}
    {playing}
    canSpeak={speaker !== undefined}
    onselect={go}
    onvoice={toggleVoice}
  />
{/snippet}

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    height: 100%;
  }

  .code-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  @media (max-width: 899px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>

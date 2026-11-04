<script lang="ts">
import type { ResolvedAnchor, Selection } from "../shared/anchor.ts";
import type { DiffRequest } from "../shared/diff-base.ts";
import type { Intent } from "../shared/intent.ts";
import { spokenProgress } from "./announcer.ts";
import { ask, interruptAsk } from "./ask.ts";
import CodePane from "./CodePane.svelte";
import Conversation, { type Note, type Turn } from "./Conversation.svelte";
import { type Command, matchCommand } from "./commands.ts";
import { chooseDetector } from "./hands-free.ts";
import { type Highlight, moveHighlight } from "./highlight.ts";
import Player from "./Player.svelte";
import { postPlayed, postSkipped } from "./played.ts";
import { anchorTarget, firstPosition, neighbour, type PlayerStep, type Position } from "./player.ts";
import { createPrimm } from "./primm.svelte.ts";
import { createSetup } from "./setup.svelte.ts";
import { createTalk } from "./talk.svelte.ts";
import { chooseTranscriber } from "./transcribe.ts";
import VoicePill from "./VoicePill.svelte";
import { createVoice } from "./voice.svelte.ts";
import { watchCode } from "./watch.ts";

const token = document.querySelector<HTMLMetaElement>('meta[name="miyagi-token"]')?.content ?? "";

const projectName = decodeURIComponent(
  document.querySelector<HTMLMetaElement>('meta[name="miyagi-project"]')?.content ?? "",
);
const voiceChoice =
  document.querySelector<HTMLMetaElement>('meta[name="miyagi-voice"]')?.content ?? "browser";
const elevenLabs = voiceChoice === "elevenlabs";

let question = $state("");
let selection = $state<Selection>();
const selectionLabel = $derived(
  selection && `${selection.file}:${selection.start}${selection.end > selection.start ? `-${selection.end}` : ""}`,
);
let asking = $state(false);
let highlight = $state<Highlight>();
let staleNotice = $state("");
let reloads = $state(0);
let steps = $state<PlayerStep[]>([]);
let tutorLine = $state<string>();
let position = $state<Position>();
let tourStarted = false;
type EarlierTour = {
  question: string;
  steps: PlayerStep[];
  tutorLine: string | undefined;
  at: Position;
  waits: boolean;
};
const earlierTours: EarlierTour[] = [];
let tourQuestion = "";
let talkPausedPlayback = false;
let awaitingAnswer = $state(false);
let running: AbortController | undefined;
let intentChoice = $state<Intent>();
const previous = $derived(position && neighbour(steps, position, -1));
const next = $derived(position && neighbour(steps, position, 1));

function showCode(chosen: Position) {
  const entry = steps[chosen.step];
  const target = entry && anchorTarget(entry, chosen.segment);
  if (target) highlight = moveHighlight(highlight, target.file, target.range, target.base);
}

function select(chosen: Position) {
  position = chosen;
  staleNotice = "";
  showCode(chosen);
}

function applyRanges(ranges: (ResolvedAnchor | null)[][]) {
  steps = steps.map((entry, index) => ({ ...entry, ranges: ranges[index] ?? entry.ranges }));
  staleNotice = "";
  reloads += 1;
  const entry = position && steps[position.step];
  const target = position && entry && anchorTarget(entry, position.segment);
  if (target) highlight = { file: target.file, current: target.range, previous: null, base: target.base };
}

void watchCode(token, (event) => {
  if (event.type === "ranges") {
    applyRanges(event.ranges);
    return;
  }
  if (highlight?.file === event.file) highlight = { ...highlight, current: null, previous: null };
  staleNotice = "Code changed; highlight removed";
}).catch((error: unknown) => console.warn("Stopped watching the code", error));

const primm = createPrimm({
  token,
  tour: () => tourQuestion,
  steps: () => steps,
  show: showCode,
  showFile: (file, range) => (highlight = { file, current: range, previous: null }),
  tell: (text) => note("tutor", text),
});

const voice = createVoice({
  choice: voiceChoice,
  token,
  steps: () => steps,
  closing: () => tutorLine,
  onLead: showCode,
  interlude: primm.interlude,
  onStart: select,
  onEnd: () => {
    if (!asking) markPlayed();
    resumeEarlierTour();
  },
  onTextMode: (interrupted) => {
    earlierTours.length = 0;
    markShownTourPlayed();
    const at = position ? undefined : (interrupted ?? firstPosition(steps));
    if (at) select(at);
  },
});

function markPlayed() {
  postPlayed(tourQuestion, token).catch((error: unknown) =>
    console.warn("Could not report the played tour", error),
  );
}

function markShownTourPlayed() {
  if (!asking && steps.length > 0) markPlayed();
}

function announce(text: string) {
  if (voice.on && steps.length === 0) voice.announcer?.say(text);
}

function go(chosen: Position) {
  tourStarted = true;
  if (!voice.play(chosen)) select(chosen);
}

function selectFirst() {
  const first = firstPosition(steps);
  if (first) go(first);
}

function resume() {
  if (earlierTours.length > 0 && !voice.interrupted && !voice.playing && !asking) {
    restoreEarlierTour();
    return;
  }
  const at = voice.interrupted ?? position;
  if (at) go(at);
  else selectFirst();
}

function toggleVoice() {
  if (voice.toggle()) return;
  earlierTours.length = 0;
  markShownTourPlayed();
}

let turns = $state<Turn[]>([]);

function startTurn(question: string, notes: Note[]) {
  const finished = turns.at(-1);
  if (finished) finished.titles = steps.map((entry) => entry.step.title);
  turns.push({ question, notes, titles: [], check: undefined, intent: undefined });
}

function restoreEarlierTour() {
  const earlier = earlierTours.pop();
  if (!earlier) return;
  voice.cancelFirstSound();
  startTurn("", [{ kind: "progress", text: "Back to where we were" }]);
  steps = earlier.steps;
  tutorLine = earlier.tutorLine;
  tourQuestion = earlier.question;
  position = undefined;
  highlight = undefined;
  voice.announcer?.say("Now, back to where we were.");
  go(earlier.at);
}

function resumeEarlierTour() {
  if (earlierTours.length === 0 || earlierTours.at(-1)?.waits || asking || voice.playing) return;
  if (!voice.on || awaitingAnswer) return;
  if (!voice.caughtUp && (steps.length > 0 || tutorLine)) return;
  restoreEarlierTour();
}

function note(kind: Note["kind"], text: string) {
  turns.at(-1)?.notes.push({ kind, text });
}

function askText(text: string) {
  question = text;
  return sendQuestion();
}

function explainDiff(text: string, diff: DiffRequest) {
  question = text;
  return sendQuestion(diff);
}

function runCommand(command: Command) {
  if (command === "back" && previous) go(previous);
  else if (command === "skip" && next) go(next);
  else if (command === "repeat" && position) go(position);
  else if (command === "pause") voice.pause();
  else if (command === "resume") resume();
  else {
    if (command === "slower") voice.changeSpeed(-1);
    if (command === "faster") voice.changeSpeed(1);
    if (talkPausedPlayback) resume();
  }
}

function canRun(command: Command | undefined) {
  return position !== undefined || (command === "resume" && earlierTours.length > 0);
}

async function sendTyped() {
  const text = question.trim();
  if (text && primm.predicting) {
    question = "";
    primm.predict(text);
    return;
  }
  if (!text || !setup.askingGoal) return sendQuestion();
  if (await setup.answer(text, text)) question = "";
}

async function handleTranscript(text: string) {
  const command = matchCommand(text);
  if (command && canRun(command) && !primm.predicting) runCommand(command);
  else {
    question = text;
    await sendTyped();
  }
}

function pauseForTalk() {
  if (primm.predicting) return;
  talkPausedPlayback = voice.playing;
  voice.pause();
}

async function sendQuestion(diff?: DiffRequest) {
  const text = question.trim();
  if (!text) return;
  const streaming = running !== undefined;
  if (running) {
    running.abort();
    await interruptAsk(token);
  }
  question = "";
  asking = true;
  const controller = new AbortController();
  running = controller;
  const attached = selection;
  selection = undefined;
  voice.pause();
  voice.asked();
  const interrupted = voice.takeInterrupted();
  const watching = interrupted ?? position;
  const onScreen =
    steps.length > 0 && watching
      ? { tour: tourQuestion, step: watching.step, segmentIndex: watching.segment }
      : undefined;
  const setAsideAt = interrupted ?? (streaming ? (position ?? firstPosition(steps)) : undefined);
  const setAside: EarlierTour | undefined =
    voice.on && setAsideAt && steps.length > 0
      ? { question: tourQuestion, steps, tutorLine, at: setAsideAt, waits: false }
      : undefined;
  if (setAside) earlierTours.push(setAside);
  tourQuestion = text;
  awaitingAnswer = false;
  primm.reset();
  startTurn(text, []);
  steps = [];
  tutorLine = undefined;
  position = undefined;
  tourStarted = false;
  highlight = undefined;
  staleNotice = "";
  let progressSpoken = 0;
  let toured = false;
  try {
    await ask(text, token, attached, onScreen, diff, intentChoice, (askEvent) => {
      if (controller.signal.aborted) return;
      if (askEvent.type === "ack") {
        note("ack", askEvent.text);
        announce(askEvent.text);
      } else if (askEvent.type === "progress") {
        note("progress", askEvent.text);
        const line = spokenProgress(askEvent.text, progressSpoken);
        if (line) {
          progressSpoken += 1;
          announce(line);
        }
      } else if (askEvent.type === "step") {
        voice.announcer?.dropWaiting();
        steps.push({ step: askEvent.step, ranges: askEvent.ranges, base: diff?.base });
        const resumeAt = voice.caughtUp && position && neighbour(steps, position, 1);
        if (resumeAt) go(resumeAt);
        else if (!tourStarted) selectFirst();
      } else if (askEvent.type === "tour") {
        toured = true;
        steps = askEvent.tour.steps.map((step, index) => ({
          step,
          ranges: askEvent.ranges[index] ?? [],
          base: diff?.base,
        }));
        if (!tourStarted || (position && !steps[position.step]?.step.narration[position.segment])) {
          selectFirst();
        }
        if (setAside) setAside.waits = askEvent.tour.scope === "new";
        if (askEvent.tour.scope === "side") primm.skip();
        tutorLine = askEvent.tour.reply ?? askEvent.tour.checkQuestion;
        awaitingAnswer = !askEvent.tour.reply && askEvent.tour.checkQuestion !== undefined;
        const current = turns.at(-1);
        if (current) {
          current.check = tutorLine;
          current.intent = askEvent.tour.intent;
        }
        if (tutorLine && voice.on && (voice.caughtUp || steps.length === 0)) voice.playClosing();
      } else if (askEvent.type === "error") {
        note("error", askEvent.message);
      }
    }, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) note("error", error instanceof Error ? error.message : String(error));
  }
  if (controller.signal.aborted) return;
  running = undefined;
  asking = false;
  voice.answered();
  if (toured && (!voice.on || (voice.caughtUp && !voice.playing))) markPlayed();
  resumeEarlierTour();
}

function skipCheck() {
  awaitingAnswer = false;
  postSkipped(tourQuestion, token).catch((error: unknown) =>
    console.warn("Could not report the skipped question", error),
  );
  resumeEarlierTour();
}

const setup = createSetup({
  token,
  say: (text) => {
    if (voice.on) voice.announcer?.say(text);
  },
  turnCount: () => turns.length,
});

let microphoneButton = $state<HTMLButtonElement>();

const talk = createTalk({
  transcribe: chooseTranscriber(elevenLabs, token),
  button: () => microphoneButton,
  onstart: pauseForTalk,
  ontranscript: handleTranscript,
  detect: chooseDetector(),
  duck: voice.duck,
});

const micNotice = $derived(
  talk.notice || (talk.handsFree === "listening" ? "Listening hands-free" : ""),
);
</script>

<svelte:window
  onkeydown={talk.keydown}
  onkeyup={talk.keyup}
  onblur={talk.stop}
  onpointerdown={talk.pointerused}
/>

<main class="app">
  <CodePane
    {highlight}
    {staleNotice}
    {reloads}
    {token}
    welcome={turns.length === 0}
    {projectName}
    onpick={(picked) => (selection = picked)}
    online={primm.clicked}
    onsuggest={askText}
  >
    {#if voice.on && steps.length > 0}
      <VoicePill
        title={position ? (steps[position.step]?.step.title ?? "") : ""}
        {previous}
        {next}
        playing={voice.playing}
        onselect={go}
        onpause={voice.pause}
        onresume={resume}
        onvoice={toggleVoice}
      />
    {/if}
  </CodePane>
  <Conversation
    {turns}
    tourVisible={steps.length > 0}
    {tour}
    bind:question
    bind:microphoneButton
    {selectionLabel}
    {elevenLabs}
    voiceNotice={voice.notice}
    profileNotice={setup.notice}
    setup={setup.view}
    onanswer={setup.answer}
    onskip={setup.skip}
    onprofile={setup.start}
    teaching={setup.teaching}
    onmode={setup.setMode}
    {intentChoice}
    onintent={(chosen) => (intentChoice = chosen)}
    {micNotice}
    recording={talk.recording}
    handsFree={talk.handsFree !== "off"}
    {asking}
    onsend={sendTyped}
    onexplaindiff={explainDiff}
    onremoveselection={() => (selection = undefined)}
    onmicdown={talk.pointerdown}
    onmicup={talk.stop}
    ontogglehandsfree={talk.toggleHandsFree}
    primm={primm.view}
    onprimmskip={primm.skip}
    checkOpen={awaitingAnswer}
    oncheckskip={skipCheck}
  />
</main>

{#snippet tour()}
  <Player
    {steps}
    {position}
    {previous}
    {next}
    voiceOn={voice.on}
    playing={voice.playing}
    canSpeak={voice.canSpeak}
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

  @media (max-width: 899px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>

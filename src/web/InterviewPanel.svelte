<script lang="ts">
import type { ResolvedAnchor } from "../shared/anchor.ts";
import type { Difficulty } from "../shared/interview.ts";
import type { InterviewView } from "./interview.svelte.ts";
import { formatTimeLeft } from "./interview.ts";

let {
  interview,
  onchoose,
  onvoiceonly,
  onstart,
  onshowcode,
  ongrade,
  onclose,
}: {
  interview: InterviewView;
  onchoose: (difficulty: Difficulty) => void;
  onvoiceonly: (voiceOnly: boolean) => void;
  onstart: () => void;
  onshowcode: (range: ResolvedAnchor) => void;
  ongrade: () => void;
  onclose: () => void;
} = $props();

let now = $state(Date.now());

$effect(() => {
  if (interview.phase !== "running") return;
  now = Date.now();
  const tick = setInterval(() => (now = Date.now()), 1000);
  return () => clearInterval(tick);
});

const timeLeft = $derived(interview.endsAt === undefined ? 0 : interview.endsAt - now);

const dimensions = ["accuracy", "reasoning", "depth", "clarity"] as const;

const difficulties: { value: Difficulty; label: string }[] = [
  { value: "friendly", label: "Friendly" },
  { value: "realistic", label: "Realistic" },
  { value: "tough", label: "Tough" },
];
</script>

<section class="interview" aria-label="Mock interview">
  <h3>Mock interview</h3>
  {#if interview.phase === "setup"}
    <fieldset>
      <legend>Difficulty</legend>
      {#each difficulties as choice}
        <label>
          <input
            type="radio"
            name="difficulty"
            value={choice.value}
            checked={interview.difficulty === choice.value}
            onchange={() => onchoose(choice.value)}
          />
          {choice.label}
        </label>
      {/each}
    </fieldset>
    <label>
      <input
        type="checkbox"
        checked={interview.voiceOnly}
        onchange={(event) => onvoiceonly(event.currentTarget.checked)}
      />
      Voice-only
    </label>
    <button type="button" class="primary" disabled={interview.busy} onclick={onstart}>
      {interview.busy ? "Planning questions…" : "Start"}
    </button>
  {:else if interview.question}
    {#if interview.phase === "running"}
      <p role="timer" class="muted">
        {timeLeft > 0 ? `Time left ${formatTimeLeft(timeLeft)}` : "Time is up. Finish your answer."}
      </p>
    {/if}
    <p class="muted">Question {interview.question.number} of {interview.question.total}</p>
    <p>{interview.question.question}</p>
    <ul class="conversation lines" aria-label="Interview exchange">
      {#each interview.lines as line}
        <li class={line.who === "you" ? "question" : "tutor"}>{line.text}</li>
      {/each}
    </ul>
    {#if interview.phase === "finished"}
      <p>That was the last question.</p>
      {#if interview.busy}
        <p class="muted" role="status">Grading your interview…</p>
      {:else if interview.debrief}
        <section class="scorecard" aria-label="Scorecard">
          <p><strong>Overall {interview.debrief.overall} out of 5</strong></p>
          {#if interview.debrief.weak.length > 0}
            <p>Weak topics: {interview.debrief.weak.join(", ")}</p>
          {/if}
          {#each interview.debrief.questions as graded}
            <article>
              <h4>{graded.number}. {graded.concept}</h4>
              <p class="muted">{graded.question}</p>
              <ul class="scores">
                {#each dimensions as dimension}
                  <li>
                    <span class="dimension">{dimension}</span> {graded.scores[dimension]}
                  </li>
                {/each}
              </ul>
              {#each graded.gaps as gap}
                <p>{gap}</p>
              {/each}
              {#each graded.ranges as range}
                <button type="button" onclick={() => onshowcode(range)}>
                  Show {range.file}:{range.start}
                </button>
              {/each}
              <p><strong>A good answer:</strong> {graded.modelAnswer}</p>
            </article>
          {/each}
        </section>
      {:else if interview.problem}
        <button type="button" onclick={ongrade}>Try again</button>
      {/if}
    {/if}
  {/if}
  {#if interview.problem}
    <p class="error">{interview.problem}</p>
  {/if}
  <button type="button" onclick={onclose}>{interview.phase === "running" ? "Stop" : "Close"}</button>
</section>

<style>
  .interview {
    display: grid;
    gap: var(--space);
    justify-items: start;
    padding: calc(var(--space) * 1.5);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  h3 {
    font-size: 1rem;
  }

  fieldset {
    display: flex;
    gap: calc(var(--space) * 2);
    border: none;
  }

  .lines {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: calc(var(--space) / 2);
    width: 100%;
  }

  .scorecard {
    display: grid;
    gap: var(--space);
    width: 100%;
  }

  .scorecard article {
    display: grid;
    gap: calc(var(--space) / 2);
    justify-items: start;
    padding-top: var(--space);
    border-top: 1px solid var(--border);
  }

  .scores {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--space) * 2);
  }

  .dimension {
    text-transform: capitalize;
  }

  .muted {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .error {
    color: var(--error);
  }
</style>

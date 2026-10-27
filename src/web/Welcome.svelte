<script lang="ts">
let { projectName, onsuggest }: { projectName: string; onsuggest: (text: string) => void } = $props();

const suggestions = [
  "Where does this app start?",
  "What are the main parts of this project?",
  "Walk me through the most important flow",
];
</script>

<section class="welcome" aria-label="Welcome">
  <h1>{projectName}</h1>
  <p>Miyagi explains this code out loud and highlights what it talks about.</p>
  <div class="suggestions">
    {#each suggestions as suggestion}
      <button type="button" onclick={() => onsuggest(suggestion)}>{suggestion}</button>
    {/each}
  </div>
</section>

<style>
  .welcome {
    margin: auto;
    max-width: 520px;
    padding: calc(var(--space) * 3);
    display: grid;
    gap: calc(var(--space) * 2);
    justify-items: start;
  }

  .welcome p {
    color: var(--muted);
  }

  .suggestions {
    display: grid;
    gap: var(--space);
    justify-items: start;
  }
</style>

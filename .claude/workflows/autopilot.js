export const meta = {
  name: 'autopilot',
  description: 'Build the plan phase by phase: one agent per feature, test-first; each part of related features independently reviewed and committed once. Never pushes.',
  whenToUse: 'Unattended runs, for example overnight. Optional args: { phases: n } to stop after n phases. Stops at the first feature or part it cannot finish cleanly.',
  phases: [
    { title: 'Plan', detail: 'read docs/PLAN.md and git status, group the features into parts' },
    { title: 'Build', detail: 'one fresh Sonnet agent per feature: test-first, checked and staged', model: 'sonnet' },
    { title: 'Verify', detail: 'one independent review per part, on the session model' },
    { title: 'Fix', detail: 'Sonnet first, the session model for the last round' },
    { title: 'Ship', detail: 'one commit per part; the last part proves the gate and marks the phase shipped' },
  ],
}

const BUILD_MODEL = 'sonnet'
const MAX_FIX_ROUNDS = 2
const MAX_PHASES = args && Number.isInteger(args.phases) && args.phases > 0 ? args.phases : Infinity
const UNATTENDED = 'Nobody is watching this run, so never ask the user anything. Never push, reset, rebase, or delete work you did not create.'
const PART_SCOPE = 'This is every uncommitted change, staged or not: all the features of this part together.'

const PLAN = {
  type: 'object',
  properties: {
    phase: { type: 'string' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          features: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'features'],
      },
    },
    stop: { type: 'string' },
  },
  required: ['phase', 'parts', 'stop'],
}

const BUILD = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string' },
  },
  required: ['status', 'summary'],
}

const PROBLEMS = {
  type: 'object',
  properties: { problems: { type: 'array', items: { type: 'string' } } },
  required: ['problems'],
}

const COMMIT = {
  type: 'object',
  properties: {
    hash: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['hash', 'message'],
}

const FEATURE_CHECKS = 'Run the check script and report every failure. For each feature in this part, read its text in docs/PLAN.md, its tests and its code: every behaviour the text describes needs a test that would fail if that behaviour broke. Report any behaviour without a test, any test that would still pass with the feature removed, and any existing test that was weakened or deleted. Also apply .claude/agents/correctness-reviewer.md and .claude/agents/ponytail-reviewer.md as checklists, and look for what only shows across features: repeated code, drifted contracts, code a later feature made unused.'
const GATE_CHECK = 'This is the last part of the phase, so also prove the phase\'s Gate line in docs/PLAN.md by running the commands that demonstrate it; report a problem if it fails or cannot be shown without a person.'

const run = []

function finish(reason) {
  return { stoppedBecause: reason, phases: run }
}

async function review(subject, checks, label) {
  const result = await agent(
    `${UNATTENDED} Independently review ${subject}. ${PART_SCOPE} Do not edit any file. ${checks} Return only real problems that must change, each with file and line. Leave out optional suggestions. Return an empty list if there are none.`,
    { label: `verify ${label}`, phase: 'Verify', schema: PROBLEMS, effort: 'high' },
  )
  if (!result) return ['The review agent failed to run, so this work is unverified.']
  return result.problems
}

async function verifyUntilClean(subject, checks, label) {
  let problems = await review(subject, checks, label)
  let rounds = 0
  while (problems.length && rounds < MAX_FIX_ROUNDS) {
    rounds += 1
    log(`${label}: fix round ${rounds}, ${problems.length} problems`)
    await agent(
      `${UNATTENDED} Never commit. Fix these problems in ${subject}. ${PART_SCOPE} Never weaken or delete a test to make it pass; if a test itself is wrong, fix the test and say why. Run the check script when done, then run git add -A.\n\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
      { label: `fix ${label} round ${rounds}`, phase: 'Fix', model: rounds < MAX_FIX_ROUNDS ? BUILD_MODEL : undefined },
    )
    problems = await review(subject, checks, `${label} round ${rounds}`)
  }
  return { problems, rounds }
}

while (run.length < MAX_PHASES) {
  phase('Plan')
  const plan = await agent(
    `${UNATTENDED} Read docs/PLAN.md and run git status. The current phase is the first one whose heading is not marked (shipped). Return its name, and its unticked features in order, each as the feature's name in bold on its checkbox line, without the trailing period. Group them into parts of related features that belong in one commit, keeping plan order: one part for a small phase, at most three for a large one, never one part per feature unless the phase has a single feature. Name each part in a few lowercase words. Return an empty list if all are ticked. Set stop to a one-line reason when every phase is shipped, or when there are uncommitted changes that do not belong to features of the current phase. Otherwise set stop to an empty string.`,
    { label: `read plan ${run.length + 1}`, phase: 'Plan', schema: PLAN, model: BUILD_MODEL, effort: 'low' },
  )
  if (!plan) return finish('The plan could not be read.')
  if (plan.stop) return finish(plan.stop)

  const current = { phase: plan.phase, parts: [] }
  run.push(current)
  log(`${plan.phase}: ${plan.parts.length} parts to build`)

  for (const [partIndex, part] of plan.parts.entries()) {
    const isLastPart = partIndex === plan.parts.length - 1
    const partLabel = `p${run.length} part ${partIndex + 1}/${plan.parts.length}`
    const done = { name: part.name, features: [], commit: null }
    current.parts.push(done)

    for (const [index, feature] of part.features.entries()) {
      const label = `${partLabel} ${index + 1}/${part.features.length}`
      phase('Build')
      const built = await agent(
        `${UNATTENDED} Never commit. Build this feature from docs/PLAN.md: "${feature}". Staged changes are earlier features of this part; leave them alone unless this feature needs them changed. Its text in docs/PLAN.md says exactly what it must do; docs/ARCHITECTURE.md says where it lives. Follow .claude/skills/feature/SKILL.md, but skip its test audit step, because one independent agent reviews the whole part later. If the feature depends on an open question, its text leaves a design decision open, or you would need to ask the user anything, stop before writing code; if you already changed files, run git stash push --keep-index --include-untracked -m "autopilot: ${label}"; then return blocked with the exact question. Otherwise, when the tests were written first and failed for the right reason, they now pass, the check script passes, and the feature is ticked in docs/PLAN.md, run git add -A and return done.`,
        { label: `build ${label}`, phase: 'Build', schema: BUILD, model: BUILD_MODEL },
      )
      if (!built || built.status !== 'done') {
        done.features.push({ feature, status: 'blocked', reason: built ? built.summary : 'The build agent failed to run.' })
        return finish(`Blocked on ${feature}. Earlier features of this part are staged, not committed.`)
      }
      done.features.push({ feature, status: 'done', summary: built.summary })
    }

    phase('Verify')
    const subject = `the part "${part.name}" of "${plan.phase}"`
    const checks = isLastPart ? `${FEATURE_CHECKS} ${GATE_CHECK}` : FEATURE_CHECKS
    const verified = await verifyUntilClean(subject, checks, partLabel)
    done.fixRounds = verified.rounds
    if (verified.problems.length) {
      done.problems = verified.problems
      return finish(`${part.name} still failed its review after ${MAX_FIX_ROUNDS} fix rounds. Its changes are left uncommitted.`)
    }

    phase('Ship')
    const shipped = isLastPart ? ' This is the last part, so also mark the phase heading in docs/PLAN.md with (shipped).' : ''
    const commit = await agent(
      `${UNATTENDED} ${subject} passed its review. Commit it: make docs/ARCHITECTURE.md match the code; add the part's user-visible changes under [Unreleased] in CHANGELOG.md.${shipped} Then run git add -A, check that no .env file, playbook file or CLAUDE.local.md is staged, and commit with exactly one line, feat: ${part.name}, at most 50 characters, with no body and no trailers. Return the commit hash and message.`,
      { label: `commit ${partLabel}`, phase: 'Ship', schema: COMMIT, model: BUILD_MODEL },
    )
    if (!commit || !commit.hash) return finish(`${part.name} passed but the commit failed. Its changes are staged.`)
    done.commit = commit
    log(`${part.name} committed: ${commit.message}`)
  }
}

return finish(`Stopped after the number of phases asked for (${MAX_PHASES}).`)

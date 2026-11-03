import type { DiffBase, DiffRequest } from "../../shared/diff-base.ts";
import type { Result } from "../../shared/result.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";
import { branchCommitMessages, diffAgainstBase } from "../source/diff-base.ts";
import { limitLines, noChanges } from "../tools/git.ts";
import { findCoveringTests, findRisks } from "./diff-risks.ts";

const baseLabels: Record<DiffBase, string> = {
  uncommitted: "the uncommitted changes since the last commit",
  branch: "the changes on this branch since it started",
  snapshot: "the changes since the snapshot",
};

const noRisks =
  "No removed guards, throws or tests and no changed try/catch were found in the diff.";

const nobodySaidWhy =
  'Nobody said why this change was made. Start every claim about its intent with "it looks like" and never state a reason as fact.';

export const diffRules = `Explaining a diff:
- The message holds the learner's diff and what is known about why it was made, inside untrusted blocks. In the diff, lines starting with "+" are new and lines starting with "-" were removed.
- Order the steps problem, then intent, then how: first what was wrong or missing before the change, then what the change sets out to do, then how the code does it. Follow the flow of the code, not the order of the files.
- Use the reason you are given. When the message says nobody said why, start every claim about the intent with "it looks like".
- Anchors point at the new code by default: leave "side" out. To point at code that was removed or replaced, set side: "old" on that anchor; the learner sees the old and new code side by side, with the highlight on the side you name. An old-side anchor is checked against the code before the change, so quote or name it as it was.
- Changes that only touch whitespace, comments or import order, or only rename something, share one step. Say so briefly and move on.
- The message also lists the risks that code found in the whole diff, and the changed tests with the changed source files they import. Use the covering tests as proof of intent: in the step for a source file, point at the changed test that covers it and say what it checks.
- When risks are listed, make the last step "Things to verify": one item for each removed guard or throw, changed try/catch and deleted test, with why it needs a check. Never invent a risk: no step when there are no risks.
- The diff in the message stops after 200 lines. For an uncommitted or branch diff you can use the git tool to see more, and read_file for the code around a change.`;

async function reasons(root: string, diff: DiffRequest): Promise<Result<string[]>> {
  const commits = diff.base === "branch" ? await branchCommitMessages(root) : undefined;
  if (commits && !commits.ok) return commits;
  const parts = [
    ...(diff.why ? [wrapUntrusted("why", diff.why)] : []),
    ...(commits?.value.length
      ? [wrapUntrusted("commit_messages", commits.value.join("\n\n"))]
      : []),
  ];
  return { ok: true, value: parts };
}

async function riskParts(root: string, fullDiff: string) {
  const risks = findRisks(fullDiff);
  const covering = await findCoveringTests(root, fullDiff);
  return [
    ...(risks.length > 0
      ? ["Risks found in the diff by code:", wrapUntrusted("risk_flags", risks.join("\n"))]
      : [noRisks]),
    ...(covering.length > 0
      ? [
          "Changed tests and the changed source files they import:",
          wrapUntrusted("covering_tests", covering.join("\n")),
        ]
      : []),
  ];
}

export async function buildDiffContext(root: string, diff: DiffRequest): Promise<Result<string>> {
  const changes = await diffAgainstBase(root, diff.base);
  if (!changes.ok) return changes;
  if (changes.value === noChanges) return { ok: false, error: "There are no changes to explain." };
  const why = await reasons(root, diff);
  if (!why.ok) return why;
  const text = [
    `Explain ${baseLabels[diff.base]}.`,
    ...(why.value.length > 0 ? ["Why the change was made:", ...why.value] : [nobodySaidWhy]),
    "The diff:",
    wrapUntrusted("diff", limitLines(changes.value, false)),
    ...(await riskParts(root, changes.value)),
  ].join("\n");
  return { ok: true, value: redact(text) };
}

import { describe, expect, it } from "vitest";
import { createQuestionPolicy } from "./question-policy.ts";

function eligibleTours(
  frequency: "light" | "normal" | "frequent",
  count: number,
  policy = createQuestionPolicy(),
) {
  const allowed: boolean[] = [];
  for (let tour = 0; tour < count; tour++) {
    const may = policy.mayAsk(frequency);
    allowed.push(may);
    policy.tourEnded(may);
  }
  return allowed;
}

describe("createQuestionPolicy", () => {
  it("allows a question on every eligible tour when the frequency is frequent", () => {
    expect(eligibleTours("frequent", 3)).toEqual([true, true, true]);
  });

  it("allows a question on every 2nd eligible tour when the frequency is normal", () => {
    expect(eligibleTours("normal", 4)).toEqual([false, true, false, true]);
  });

  it("allows a question on every 3rd eligible tour when the frequency is light", () => {
    expect(eligibleTours("light", 6)).toEqual([false, false, true, false, false, true]);
  });

  it("does not move the schedule when mayAsk is asked but the tour never ends", () => {
    const policy = createQuestionPolicy();

    expect(policy.mayAsk("normal")).toBe(false);
    expect(policy.mayAsk("normal")).toBe(false);
    policy.tourEnded(false);
    expect(policy.mayAsk("normal")).toBe(true);
  });

  it("suppresses the next 3 eligible tours after two skipped questions in a row", () => {
    const policy = createQuestionPolicy();
    policy.tourEnded(true);
    policy.skipped();
    policy.tourEnded(true);
    policy.skipped();

    expect(eligibleTours("frequent", 5, policy)).toEqual([false, false, false, true, true]);
  });

  it("does not suppress when a question was answered between two skipped ones", () => {
    const policy = createQuestionPolicy();
    policy.tourEnded(true);
    policy.skipped();
    policy.tourEnded(true);
    policy.tourEnded(true);
    policy.skipped();

    expect(policy.mayAsk("frequent")).toBe(true);
  });

  it("starts the count again after a suppression, so two more skips are needed", () => {
    const policy = createQuestionPolicy();
    for (let skip = 0; skip < 2; skip++) {
      policy.tourEnded(true);
      policy.skipped();
    }
    eligibleTours("frequent", 3, policy);
    policy.tourEnded(true);
    policy.skipped();

    expect(policy.mayAsk("frequent")).toBe(true);
  });
});

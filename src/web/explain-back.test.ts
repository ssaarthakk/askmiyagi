import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplainBackReply } from "../shared/learner.ts";
import { createExplainBack } from "./explain-back.svelte.ts";
import { postSkipped } from "./played.ts";
import { fetchDue, postExplainBack, postReviewSkipped } from "./reviews.ts";

vi.mock("./reviews.ts", () => ({
  fetchDue: vi.fn(),
  postExplainBack: vi.fn(),
  postReviewSkipped: vi.fn(),
}));
vi.mock("./played.ts", () => ({ postSkipped: vi.fn() }));

const range = { file: "a.ts", start: 2, end: 4, capped: false };
const passed: ExplainBackReply = {
  outcome: "passed",
  score: 5,
  gaps: [],
  ranges: [],
  modelAnswer: null,
};

function setup() {
  const said: string[] = [];
  const learner: string[] = [];
  const problems: string[] = [];
  const shown: unknown[] = [];
  let turns = 0;
  const explainBack = createExplainBack({
    token: "t",
    tour: () => "How are clips saved?",
    tutorSays: (text) => said.push(text),
    learnerSays: (text) => learner.push(text),
    problem: (text) => problems.push(text),
    openTurn: () => {
      turns += 1;
    },
    showFile: (file, shownRange) => shown.push({ file, range: shownRange }),
  });
  return { explainBack, said, learner, problems, shown, turns: () => turns };
}

beforeEach(() => {
  vi.mocked(postExplainBack).mockReset();
  vi.mocked(fetchDue).mockReset().mockResolvedValue([]);
  vi.mocked(postReviewSkipped).mockReset().mockResolvedValue(undefined);
  vi.mocked(postSkipped).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("createExplainBack answers", () => {
  it("waits for the concept's explanation, and a pass clears it", async () => {
    vi.mocked(postExplainBack).mockResolvedValue(passed);
    const { explainBack, said, learner } = setup();
    explainBack.expect("Upload retries");

    expect(explainBack.concept).toBe("Upload retries");
    expect(await explainBack.answer("It retries")).toBe(true);

    expect(postExplainBack).toHaveBeenCalledWith("Upload retries", "It retries", false, "t");
    expect(learner).toEqual(["It retries"]);
    expect(said.join(" ")).toContain("Upload retries");
    expect(explainBack.concept).toBeUndefined();
  });

  it("names the gaps, highlights the code and keeps waiting after a low score", async () => {
    vi.mocked(postExplainBack).mockResolvedValue({
      outcome: "retry",
      score: 2,
      gaps: ["You did not say what is retried."],
      ranges: [range],
      modelAnswer: null,
    });
    const { explainBack, said, shown } = setup();
    explainBack.expect("Upload retries");

    expect(await explainBack.answer("Something")).toBe(false);

    expect(said.join(" ")).toContain("You did not say what is retried.");
    expect(shown).toEqual([{ file: "a.ts", range }]);
    expect(explainBack.concept).toBe("Upload retries");
  });

  it("gives the model answer and stops waiting after the last attempt", async () => {
    vi.mocked(postExplainBack).mockResolvedValue({
      outcome: "gave-up",
      score: 1,
      gaps: ["A gap."],
      ranges: [],
      modelAnswer: "Retried up to three times.",
    });
    const { explainBack, said } = setup();
    explainBack.expect("Upload retries");

    expect(await explainBack.answer("No idea")).toBe(true);

    expect(said.join(" ")).toContain("Retried up to three times.");
    expect(explainBack.concept).toBeUndefined();
  });

  it("shows the problem and keeps waiting when grading fails", async () => {
    vi.mocked(postExplainBack).mockRejectedValue(new Error("Rate limited"));
    const { explainBack, problems } = setup();
    explainBack.expect("Upload retries");

    expect(await explainBack.answer("Something")).toBe(false);

    expect(problems).toEqual(["Rate limited"]);
    expect(explainBack.concept).toBe("Upload retries");
  });

  it("grades one answer at a time, and nothing when no explanation is waiting", async () => {
    let finish: (reply: ExplainBackReply) => void = () => {};
    vi.mocked(postExplainBack).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { explainBack } = setup();
    expect(await explainBack.answer("Early")).toBe(false);
    explainBack.expect("Upload retries");

    const first = explainBack.answer("One");
    expect(await explainBack.answer("Two")).toBe(false);
    finish(passed);
    await first;

    expect(postExplainBack).toHaveBeenCalledTimes(1);
  });
});

describe("createExplainBack skips", () => {
  it("tells the server the end question was skipped and clears the chip", () => {
    const { explainBack } = setup();
    explainBack.expect("Upload retries");

    explainBack.skip();

    expect(postSkipped).toHaveBeenCalledWith("How are clips saved?", "t");
    expect(explainBack.concept).toBeUndefined();
  });

  it("moves a skipped review a day later instead", () => {
    const { explainBack } = setup();
    explainBack.startReview("Upload retries");

    explainBack.skip();

    expect(postReviewSkipped).toHaveBeenCalledWith("Upload retries", "t");
    expect(postSkipped).not.toHaveBeenCalled();
  });

  it("clears the chip without telling the server", () => {
    const { explainBack } = setup();
    explainBack.expect("Upload retries");

    explainBack.clear();

    expect(explainBack.concept).toBeUndefined();
    expect(postSkipped).not.toHaveBeenCalled();
  });

  it("reports a review that is cleared as skipped", () => {
    const { explainBack } = setup();
    explainBack.startReview("Upload retries");

    explainBack.clear();

    expect(postReviewSkipped).toHaveBeenCalledWith("Upload retries", "t");
    expect(explainBack.concept).toBeUndefined();
  });
});

describe("createExplainBack reviews", () => {
  it("starts a review in a new turn with the explain-back prompt", async () => {
    vi.mocked(postExplainBack).mockResolvedValue(passed);
    const { explainBack, said, turns } = setup();

    explainBack.startReview("Upload retries");

    expect(turns()).toBe(1);
    expect(said[0]).toBe("Explain Upload retries back to me in your own words.");
    expect(explainBack.concept).toBe("Upload retries");
    expect(await explainBack.answer("It retries")).toBe(true);
    expect(postExplainBack).toHaveBeenCalledWith("Upload retries", "It retries", true, "t");
  });

  it("loads the due concepts when created", async () => {
    vi.mocked(fetchDue).mockResolvedValue(["Upload retries", "Promises"]);
    const { explainBack } = setup();

    await vi.waitFor(() => expect(explainBack.due).toEqual(["Upload retries", "Promises"]));
  });

  it("keeps the old list when the due concepts cannot be loaded", async () => {
    vi.mocked(fetchDue).mockResolvedValueOnce(["Promises"]).mockRejectedValueOnce(new Error("no"));
    const { explainBack } = setup();
    await vi.waitFor(() => expect(explainBack.due).toEqual(["Promises"]));

    await explainBack.offerReview();

    expect(fetchDue).toHaveBeenCalledTimes(2);
    expect(explainBack.due).toEqual(["Promises"]);
  });

  it("offers the first due review once, and Start begins it", async () => {
    vi.mocked(fetchDue).mockResolvedValue(["Upload retries", "Promises"]);
    const { explainBack, said } = setup();

    await explainBack.offerReview();
    await explainBack.offerReview();

    expect(explainBack.offer).toBe("Upload retries");
    explainBack.startOffer();
    expect(explainBack.offer).toBeUndefined();
    expect(explainBack.concept).toBe("Upload retries");
    expect(said[0]).toContain("Upload retries");
  });

  it("offers nothing when no review is due or an explanation is already waiting", async () => {
    const { explainBack } = setup();
    await explainBack.offerReview();
    expect(explainBack.offer).toBeUndefined();

    vi.mocked(fetchDue).mockResolvedValue(["Promises"]);
    explainBack.expect("Upload retries");
    await explainBack.offerReview();
    expect(explainBack.offer).toBeUndefined();
  });

  it("moves a skipped offer a day later and withdraws it", async () => {
    vi.mocked(fetchDue).mockResolvedValue(["Upload retries"]);
    const { explainBack } = setup();
    await explainBack.offerReview();

    explainBack.skipOffer();

    expect(postReviewSkipped).toHaveBeenCalledWith("Upload retries", "t");
    expect(explainBack.offer).toBeUndefined();
  });

  it("refreshes the due list after a finished review", async () => {
    vi.mocked(postExplainBack).mockResolvedValue(passed);
    const { explainBack } = setup();
    explainBack.startReview("Upload retries");
    vi.mocked(fetchDue).mockClear();

    await explainBack.answer("It retries");

    expect(fetchDue).toHaveBeenCalled();
  });
});

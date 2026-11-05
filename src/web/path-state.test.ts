import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PathReply } from "../shared/path.ts";
import { createPath } from "./path.svelte.ts";
import { fetchPath, postPlan } from "./path.ts";

vi.mock("./path.ts", () => ({ fetchPath: vi.fn(), postPlan: vi.fn() }));

const planned: NonNullable<PathReply> = {
  items: [
    { concept: "Storage", question: "How is it stored?", file: "src/store.ts", done: false },
    { concept: "Serving", question: "How is it served?", file: "src/server.ts", done: false },
  ],
};

function setup(goal: string | null = "Add retries") {
  const said: string[] = [];
  const problems: string[] = [];
  const saved: string[] = [];
  let turns = 0;
  const path = createPath({
    token: "t",
    goal: () => goal,
    saveGoal: async (text) => {
      saved.push(text);
      goal = text;
    },
    tutorSays: (text) => said.push(text),
    problem: (text) => problems.push(text),
    openTurn: () => {
      turns += 1;
    },
  });
  return { path, said, problems, saved, turns: () => turns };
}

beforeEach(() => {
  vi.mocked(fetchPath).mockReset().mockResolvedValue(null);
  vi.mocked(postPlan).mockReset().mockResolvedValue(planned);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("createPath", () => {
  it("loads the saved path on start", async () => {
    vi.mocked(fetchPath).mockResolvedValue(planned);
    const { path } = setup();

    await vi.waitFor(() => expect(path.items).toEqual(planned.items));
  });

  it("plans from the profile's goal and shows the new path", async () => {
    const { path, saved } = setup();

    await path.plan();

    expect(postPlan).toHaveBeenCalledWith("t");
    expect(path.items).toEqual(planned.items);
    expect(path.planning).toBe(false);
    expect(saved).toEqual([]);
  });

  it("asks for a goal first when there is none, and plans with the next message as the goal", async () => {
    const { path, said, saved, turns } = setup(null);

    await path.plan();

    expect(postPlan).not.toHaveBeenCalled();
    expect(said).toEqual(["What do you want to do with this repo?"]);
    expect(turns()).toBe(1);
    expect(path.askingGoal).toBe(true);

    await path.answerGoal("Add retries");

    expect(saved).toEqual(["Add retries"]);
    expect(postPlan).toHaveBeenCalledOnce();
    expect(path.askingGoal).toBe(false);
    expect(path.items).toEqual(planned.items);
  });

  it("does not take a message as the goal after the goal question is dropped", async () => {
    const { path } = setup(null);
    await path.plan();

    path.cancelGoal();

    expect(path.askingGoal).toBe(false);
    expect(postPlan).not.toHaveBeenCalled();
  });

  it("reports a failed plan and keeps the old path", async () => {
    vi.mocked(fetchPath).mockResolvedValue(planned);
    const { path, problems } = setup();
    await vi.waitFor(() => expect(path.items).toEqual(planned.items));
    vi.mocked(postPlan).mockRejectedValue(new Error("Rate limited"));

    await path.plan();

    expect(problems).toEqual(["Rate limited"]);
    expect(path.items).toEqual(planned.items);
    expect(path.planning).toBe(false);
  });

  it("reports a goal that could not be saved, and does not plan", async () => {
    const problems: string[] = [];
    const path = createPath({
      token: "t",
      goal: () => null,
      saveGoal: async () => {
        throw new Error("Disk full");
      },
      tutorSays: () => undefined,
      problem: (text) => problems.push(text),
      openTurn: () => undefined,
    });
    await path.plan();

    await path.answerGoal("Add retries");

    expect(problems).toEqual(["Disk full"]);
    expect(postPlan).not.toHaveBeenCalled();
  });

  it("refreshes the ticks, and keeps what it has when the refresh fails", async () => {
    const { path } = setup();
    await path.plan();
    const ticked = { items: planned.items.map((item, index) => ({ ...item, done: index === 0 })) };
    vi.mocked(fetchPath).mockResolvedValueOnce(ticked);

    await path.refresh();
    expect(path.items?.map((item) => item.done)).toEqual([true, false]);

    vi.mocked(fetchPath).mockRejectedValueOnce(new Error("Offline"));
    await path.refresh();
    expect(path.items?.map((item) => item.done)).toEqual([true, false]);
  });
});

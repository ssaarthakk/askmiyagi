import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile, type Profile } from "../shared/profile.ts";
import { answerProfile, fetchProfile, profileQuestions, saveProfile } from "./profile.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const profile: Profile = {
  level: "advanced",
  mode: "answer",
  frequency: "frequent",
  goal: "Fix a bug",
};

describe("profileQuestions", () => {
  it("asks level, mode and frequency with buttons, then the goal by typing", () => {
    expect(profileQuestions.map((question) => question.key)).toEqual([
      "level",
      "mode",
      "frequency",
      "goal",
    ]);
    expect(profileQuestions[0]?.choices.map((choice) => choice.value)).toEqual([
      "beginner",
      "intermediate",
      "advanced",
    ]);
    expect(profileQuestions[3]?.choices).toEqual([]);
    expect(profileQuestions[3]?.text).toBe("What do you want to do with this repo?");
  });
});

describe("answerProfile", () => {
  it("sets the answered field and keeps the others", () => {
    expect(answerProfile(defaultProfile, "level", "beginner")).toEqual({
      ok: true,
      value: { ...defaultProfile, level: "beginner" },
    });
    expect(answerProfile(defaultProfile, "goal", "  Learn it  ")).toEqual({
      ok: true,
      value: { ...defaultProfile, goal: "Learn it" },
    });
  });

  it("sets the field to its default when the question is skipped, and keeps the others", () => {
    expect(answerProfile(profile, "level", null)).toEqual({
      ok: true,
      value: { ...profile, level: "intermediate" },
    });
    expect(answerProfile(profile, "goal", null)).toEqual({
      ok: true,
      value: { ...profile, goal: null },
    });
  });

  it("refuses an answer outside the choices or a goal that is too long", () => {
    expect(answerProfile(defaultProfile, "level", "expert").ok).toBe(false);
    expect(answerProfile(defaultProfile, "goal", "x".repeat(1001)).ok).toBe(false);
  });
});

describe("fetchProfile and saveProfile", () => {
  it("reads the saved profile, or null when there is none, with the token", async () => {
    const stub = vi.fn(async () => Response.json(profile));
    vi.stubGlobal("fetch", stub);

    expect(await fetchProfile("tok")).toEqual(profile);
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/profile");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });

    vi.stubGlobal("fetch", async () => Response.json(null));
    expect(await fetchProfile("tok")).toBeNull();
  });

  it("throws when the server sends something that is not a profile", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ level: "expert" }));

    await expect(fetchProfile("tok")).rejects.toThrow();
  });

  it("puts the profile with the token and returns the saved one", async () => {
    const stub = vi.fn(async () => Response.json(profile));
    vi.stubGlobal("fetch", stub);

    expect(await saveProfile(profile, "tok")).toEqual(profile);

    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/profile");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
    expect(JSON.parse(String(init.body))).toEqual(profile);
  });

  it("throws the server's error message when saving fails", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Disk full" }, { status: 500 }));

    await expect(saveProfile(profile, "tok")).rejects.toThrow("Disk full");
  });
});

import { defaultProfile, type Profile } from "../shared/profile.ts";
import {
  answerProfile,
  fetchProfile,
  type ProfileQuestion,
  profileQuestions,
  saveProfile,
} from "./profile.ts";
import { errorText } from "./response-error.ts";

export type SetupView = {
  after: number;
  shown: { question: string; answer: string }[];
  current: ProfileQuestion | undefined;
  chosen: string | null;
  done: boolean;
  problem: string;
};

export function createSetup(options: {
  token: string;
  say: (text: string) => void;
  turnCount: () => number;
}) {
  let profile = $state<Profile>();
  let notice = $state("");
  let after = $state(0);
  let index = $state(0);
  let draft = $state<Profile>(defaultProfile);
  let remembered = $state(false);
  let shown = $state<{ question: string; answer: string }[]>([]);
  let done = $state(false);
  let problem = $state("");
  let started = $state(false);

  function askCurrent() {
    const current = profileQuestions[index];
    if (current) options.say(current.text);
  }

  function start() {
    after = options.turnCount();
    index = 0;
    draft = profile ?? defaultProfile;
    remembered = profile !== undefined;
    shown = [];
    done = false;
    problem = "";
    started = true;
    if (navigator.userActivation.hasBeenActive) {
      askCurrent();
      return;
    }
    const activated = new AbortController();
    for (const type of ["pointerdown", "keydown"]) {
      window.addEventListener(
        type,
        () => {
          activated.abort();
          askCurrent();
        },
        { signal: activated.signal },
      );
    }
  }

  async function answer(value: string | null, shownAnswer: string) {
    const current = profileQuestions[index];
    if (!started || !current || done) return false;
    const answered = answerProfile(draft, current.key, value);
    if (!answered.ok) {
      problem = `That answer did not work: ${answered.error}`;
      return false;
    }
    problem = "";
    draft = answered.value;
    shown.push({ question: current.text, answer: shownAnswer });
    index += 1;
    if (index < profileQuestions.length) {
      askCurrent();
      return true;
    }
    try {
      profile = await saveProfile(draft, options.token);
      done = true;
    } catch (error) {
      problem = `Could not save the profile, press Profile to try again: ${errorText(error)}`;
    }
    return true;
  }

  async function setMode(mode: Profile["mode"]) {
    if (!profile) return;
    try {
      profile = await saveProfile({ ...profile, mode }, options.token);
      notice = "";
    } catch (error) {
      notice = `Could not save the mode: ${errorText(error)}`;
    }
  }

  fetchProfile(options.token)
    .then((saved) => {
      profile = saved ?? undefined;
      if (!saved) start();
    })
    .catch((error: unknown) => {
      notice = `Could not load your profile: ${errorText(error)}`;
    });

  return {
    get notice() {
      return notice;
    },
    get view(): SetupView | undefined {
      if (!started) return undefined;
      const current = profileQuestions[index];
      return {
        after,
        shown,
        current,
        chosen: current && remembered ? draft[current.key] : null,
        done,
        problem,
      };
    },
    get teaching() {
      return profile && !(started && !done) ? profile.mode === "teach" : undefined;
    },
    get askingGoal() {
      return started && !done && profileQuestions[index]?.key === "goal";
    },
    start,
    setMode,
    answer,
    skip: () => answer(null, "Skipped"),
  };
}

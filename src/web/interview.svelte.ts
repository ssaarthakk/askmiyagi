import type { DebriefReply, Difficulty, InterviewQuestion } from "../shared/interview.ts";
import { answerInterview, debriefInterview, startInterview, stopInterview } from "./interview.ts";
import { errorText } from "./response-error.ts";

export type InterviewLine = { who: "interviewer" | "you"; text: string };

export type InterviewView = {
  phase: "setup" | "running" | "finished";
  difficulty: Difficulty;
  voiceOnly: boolean;
  endsAt: number | undefined;
  question: InterviewQuestion | undefined;
  lines: InterviewLine[];
  debrief: DebriefReply | undefined;
  busy: boolean;
  problem: string;
};

export function createInterview(options: {
  token: string;
  openedByAddress: boolean;
  say: (text: string) => void;
  show: (question: InterviewQuestion) => void;
}) {
  let phase = $state<InterviewView["phase"] | undefined>(
    options.openedByAddress ? "setup" : undefined,
  );
  let difficulty = $state<Difficulty>("realistic");
  let voiceOnly = $state(false);
  let endsAt = $state<number>();
  let question = $state<InterviewQuestion>();
  let lines = $state<InterviewLine[]>([]);
  let debrief = $state<DebriefReply>();
  let busy = $state(false);
  let problem = $state("");
  let starting = false;
  let opened = 0;

  function ask(next: InterviewQuestion) {
    question = next;
    lines = [];
    options.show(next);
    options.say(next.question);
  }

  async function whileOpen<T>(request: () => Promise<T>, use: (reply: T) => void) {
    const at = opened;
    busy = true;
    problem = "";
    try {
      const reply = await request();
      if (at === opened) use(reply);
    } catch (error) {
      if (at === opened) problem = errorText(error);
    } finally {
      if (at === opened) busy = false;
    }
  }

  function grade() {
    return whileOpen(
      () => debriefInterview(options.token),
      (graded) => (debrief = graded),
    );
  }

  function close() {
    const serverSession = phase === "running" || starting;
    opened += 1;
    phase = undefined;
    question = undefined;
    lines = [];
    debrief = undefined;
    busy = false;
    starting = false;
    if (serverSession) {
      stopInterview(options.token).catch((error: unknown) =>
        console.warn("Could not stop the interview", error),
      );
    }
  }

  return {
    get view(): InterviewView | undefined {
      return (
        phase && { phase, difficulty, voiceOnly, endsAt, question, lines, debrief, busy, problem }
      );
    },
    get running() {
      return phase === "running";
    },
    get busy() {
      return busy;
    },
    get hidesCode() {
      return voiceOnly && phase === "running";
    },
    open() {
      close();
      phase = "setup";
      problem = "";
    },
    grade,
    choose(chosen: Difficulty) {
      difficulty = chosen;
    },
    chooseVoiceOnly(chosen: boolean) {
      voiceOnly = chosen;
    },
    async start() {
      const at = opened;
      starting = true;
      await whileOpen(
        () => startInterview(options.token, difficulty),
        (started) => {
          endsAt = started.endsAt;
          ask(started);
          phase = "running";
        },
      );
      if (at === opened) starting = false;
    },
    async answer(text: string) {
      if (busy) return;
      lines.push({ who: "you", text });
      await whileOpen(
        () => answerInterview(options.token, text),
        (reply) => {
          options.say(reply.say);
          if (reply.next) ask(reply.next);
          else lines.push({ who: "interviewer", text: reply.say });
          if (reply.finished) phase = "finished";
        },
      );
      if (phase === "finished" && !debrief) await grade();
    },
    close,
  };
}

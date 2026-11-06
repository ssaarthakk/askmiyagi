import { createAnnouncer } from "./announcer.ts";
import { steppedSpeed } from "./commands.ts";
import { createFirstSound, postFirstSound } from "./first-sound.ts";
import { createPlayback, type InterludeHook } from "./playback.ts";
import type { PlayerStep, Position } from "./player.ts";
import { chooseSpeaker, localVoices, noLocalVoice, type Speaker } from "./speaker.ts";

const duckedVolume = 0.2;

export function createVoice(options: {
  choice: string;
  token: string;
  steps: () => PlayerStep[];
  closing: () => string | undefined;
  onLead: (position: Position) => void;
  onStart: (position: Position) => void;
  onEnd: () => void;
  onTextMode: (interrupted: Position | undefined) => void;
  interlude: InterludeHook;
}) {
  const injectedSpeaker = (window as { __MIYAGI_SPEAKER__?: Speaker }).__MIYAGI_SPEAKER__;
  let notice = $state("");
  let label = $state("");
  const speaker =
    injectedSpeaker ??
    (typeof speechSynthesis === "undefined"
      ? undefined
      : chooseSpeaker(
          options.choice,
          options.token,
          (text) => {
            notice = text;
          },
          (text) => {
            label = text;
          },
        ));
  let on = $state(speaker !== undefined);
  let playing = $state(false);
  let caughtUp = false;
  let speed = 1;
  let interrupted: Position | undefined;
  const firstSound = createFirstSound((ms) => postFirstSound(ms, options.token));

  const announcer =
    speaker &&
    createAnnouncer(speaker, (error) => {
      if (error.message === noLocalVoice) textMode(error.message);
      else console.warn("Skipped a spoken note", error);
    });

  const playback =
    speaker &&
    createPlayback(speaker, {
      steps: options.steps,
      closing: options.closing,
      ready: () => announcer?.finished() ?? Promise.resolve(),
      onLead: options.onLead,
      interlude: options.interlude,
      onStart: (started) => {
        firstSound.started();
        options.onStart(started);
      },
      onEnd: (error) => {
        playing = false;
        caughtUp = !error;
        if (error) textMode(error.message);
        else options.onEnd();
      },
    });

  function pause() {
    firstSound.cancel();
    caughtUp = false;
    interrupted = playback?.stop() ?? interrupted;
    announcer?.stop();
    playing = false;
  }

  function textMode(text: string) {
    notice = text;
    on = false;
    pause();
    options.onTextMode(interrupted);
  }

  function play(at: Position) {
    caughtUp = false;
    interrupted = undefined;
    if (!on || !playback) return false;
    playing = true;
    void playback.play(at);
    return true;
  }

  function playClosing() {
    if (!playback) return;
    caughtUp = false;
    playing = true;
    void playback.play(undefined);
  }

  function toggle() {
    pause();
    on = !on;
    return on;
  }

  function changeSpeed(direction: 1 | -1) {
    speed = steppedSpeed(speed, direction);
    speaker?.setRate?.(speed);
  }

  function duck(lowered: boolean) {
    speaker?.setVolume?.(lowered ? duckedVolume : 1);
  }

  function takeInterrupted() {
    const at = interrupted;
    interrupted = undefined;
    return at;
  }

  if (!speaker) {
    textMode(noLocalVoice);
  } else if (!injectedSpeaker && options.choice === "browser") {
    void localVoices(speechSynthesis).then((voices) => {
      if (voices.length === 0) textMode(noLocalVoice);
    });
  }

  return {
    get on() {
      return on;
    },
    get playing() {
      return playing;
    },
    get notice() {
      return notice;
    },
    get label() {
      return label;
    },
    get caughtUp() {
      return caughtUp;
    },
    get interrupted() {
      return interrupted;
    },
    canSpeak: speaker !== undefined,
    announcer,
    play,
    playClosing,
    pause,
    toggle,
    changeSpeed,
    duck,
    takeInterrupted,
    asked() {
      if (on && playback) firstSound.asked();
    },
    answered: firstSound.answered,
    cancelFirstSound: firstSound.cancel,
  };
}

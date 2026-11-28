// The Integration Lab's session, without React, DOM or Pixi objects: a scripted input generator
// and the record / playback session. The presentation order, the stage and the placeholder
// fixture are `@mortal-doctrine/match-view`. The lab and the Node tests in `apps/studio/tests`
// both run this module, so the tests exercise the session the lab shows.
import { createTickSource, type Tick } from '@mortal-doctrine/match-view';
import { SESSION_OPTIONS } from '@mortal-doctrine/match-view/testing';
import {
  createReplayPlayer,
  createReplayRecorder,
  hashState,
  type Replay,
  type ReplayDesync,
  type ReplayPlayer,
  type ReplayRecorder,
} from '@mortal-doctrine/replay';
import { InputBit, type InputFrame } from '@mortal-doctrine/sim-core';
import {
  createSimulationRunner,
  step,
  type InputProvider,
  type SimulationRunner,
  type SimulationState,
} from '@mortal-doctrine/simulation';

const { LEFT, RIGHT, UP, DOWN, A1, A2 } = InputBit;
const SEGMENT_FRAMES = 12;
/** One held input per segment; the quarter circle is spelled out over a segment's frames. */
const ACTIONS: readonly (InputFrame | ((phase: number) => InputFrame))[] = [
  0,
  LEFT,
  LEFT,
  RIGHT,
  RIGHT,
  UP,
  UP | LEFT,
  UP | RIGHT,
  DOWN,
  A2,
  (phase) => (phase < 3 ? DOWN : phase < 6 ? DOWN | RIGHT : phase === 6 ? RIGHT | A1 : RIGHT),
];

/** FNV-1a with a final avalanche, over numbers. Audio and effects keep the same mix private. */
function mix(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) h = Math.imul(h ^ value, 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Seeded inputs for both players: walks, jumps, crouches, button presses and quarter circles in
 * 12-frame segments. A pure function of the seed and the frame, so a restored run can ask for
 * any frame's inputs again.
 */
export function scriptedInputs(seed: number): InputProvider {
  const player = (index: number, frame: number): InputFrame => {
    const segment = Math.floor(frame / SEGMENT_FRAMES);
    const action = ACTIONS[mix(seed, index, segment) % ACTIONS.length]!;
    return typeof action === 'function' ? action(frame % SEGMENT_FRAMES) : action;
  };
  return (frame) => [player(0, frame), player(1, frame)];
}

/**
 * The events of the `count` replay ticks after `from`, found by stepping again: the replay
 * player re-simulates but does not hand out the events (ticket #220).
 */
export function replayTicks(replay: Replay, from: SimulationState, count: number): Tick[] {
  const ticks: Tick[] = [];
  let state = from;
  for (let i = 0; i < count; i++) {
    const inputs = replay.inputs[state.frame];
    if (!inputs) break;
    const result = step(state, inputs);
    state = result.state;
    ticks.push(result);
  }
  return ticks;
}

/** The last frame of a recording, or of its playback. */
export interface FinalFrame {
  readonly frame: number;
  readonly hash: string;
}

export interface Session {
  readonly mode: 'live' | 'recording' | 'playback';
  readonly state: SimulationState;
  readonly paused: boolean;
  /** The finished recording, until Record or Reset. */
  readonly replay: Replay | null;
  /** Where the recording ended. */
  readonly recorded: FinalFrame | null;
  /** Where the playback ended; null until it reaches the last frame. */
  readonly played: FinalFrame | null;
  readonly desync: ReplayDesync | null;
  setPaused(paused: boolean): void;
  /** Feeds host display time; returns the ticks run, oldest first. */
  advance(elapsedMs: number): Tick[];
  /** Runs one tick regardless of pause. */
  step(): Tick[];
  /** Restarts from the fixture, running, recording every tick. */
  record(): void;
  /** Ends the recording and pauses on its last frame. */
  stop(): void;
  /** Plays the recording from frame 0. */
  playReplay(): void;
  /** Back to the fixture, paused, with no recording. */
  reset(): void;
}

/** A live, recordable and replayable simulation session. `inputs` is asked once per live tick. */
export function createSession(inputs: InputProvider): Session {
  let runner: SimulationRunner = createSimulationRunner(SESSION_OPTIONS);
  runner.pause();
  let recorder: ReplayRecorder | null = null;
  let replay: Replay | null = null;
  let recorded: FinalFrame | null = null;
  let player: ReplayPlayer | null = null;
  let played: FinalFrame | null = null;

  const live = createTickSource(() => runner.state, inputs);
  const sampled = live.inputs;
  let provider = sampled;
  const start = (record: boolean) => {
    runner = createSimulationRunner(SESSION_OPTIONS);
    recorder = record
      ? createReplayRecorder({ options: SESSION_OPTIONS, getState: () => runner.state })
      : null;
    provider = recorder ? recorder.provider(sampled) : sampled;
    replay = null;
    recorded = null;
    player = null;
    played = null;
  };
  const final = (state: SimulationState): FinalFrame => ({
    frame: state.frame,
    hash: hashState(state),
  });

  const playback = (current: ReplayPlayer, run: () => number): Tick[] => {
    const from = current.state;
    const ticks = replay ? replayTicks(replay, from, run()) : [];
    if (!played && current.frame === current.length && !current.desync)
      played = final(current.state);
    return ticks;
  };

  return {
    get mode() {
      return player ? 'playback' : recorder ? 'recording' : 'live';
    },
    get state() {
      return player?.state ?? runner.state;
    },
    get paused() {
      return player?.paused ?? runner.paused;
    },
    get replay() {
      return replay;
    },
    get recorded() {
      return recorded;
    },
    get played() {
      return played;
    },
    get desync() {
      return player?.desync ?? null;
    },
    setPaused(paused) {
      const target = player ?? runner;
      if (paused) target.pause();
      else if (player) player.play();
      else runner.resume();
    },
    advance(elapsedMs) {
      const current = player;
      return current
        ? playback(current, () => current.advance(elapsedMs))
        : live.run(() => runner.advance(elapsedMs, provider).events);
    },
    step() {
      const current = player;
      return current
        ? playback(current, () => Number(current.stepOnce()))
        : live.run(() => runner.stepOnce(provider));
    },
    record: () => start(true),
    stop() {
      if (!recorder) return;
      // Dropped before `finish` can throw: an unfinishable recording cannot be continued either.
      const finished = recorder;
      recorder = null;
      provider = sampled;
      runner.pause();
      replay = finished.finish();
      recorded = final(runner.state);
    },
    playReplay() {
      if (!replay) return;
      player = createReplayPlayer(replay);
      played = null;
      player.play();
    },
    reset() {
      start(false);
      runner.pause();
    },
  };
}

import { TICK_MS } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  step,
  type SimulationState,
  type StepResult,
} from '@mortal-doctrine/simulation';
import type { Replay } from './format';
import { digestInputs, EMPTY_INPUTS_DIGEST, formatHash, hashState } from './hash';

// Same policy as the simulation runner: cap catch-up after a stall, absorb float drift.
const MAX_CATCH_UP_MS = 250;
const EPSILON_MS = 1e-6;

interface Hashes {
  readonly stateHash: string;
  readonly inputsHash: string;
}

/** A checksum the re-simulation did not reproduce. */
export interface ReplayDesync {
  readonly frame: number;
  /** Recorded in the replay. */
  readonly expected: Hashes;
  /** Recomputed during playback. */
  readonly actual: Hashes;
}

export interface ReplayPlayer {
  readonly state: SimulationState;
  /** Same as `state.frame`: the number of replay ticks applied. */
  readonly frame: number;
  /** Total ticks in the replay. */
  readonly length: number;
  readonly paused: boolean;
  /** Set when a checksum fails; the player never advances past its frame. */
  readonly desync: ReplayDesync | null;
  /** No effect at the end of the replay or at a desync. */
  play(): void;
  pause(): void;
  /**
   * Feeds elapsed host time; runs whole ticks unless paused. Returns each tick's `step` result,
   * oldest first (empty while paused or when no whole tick accrued).
   */
  advance(elapsedMs: number): readonly StepResult[];
  /** Runs one tick regardless of pause state. Returns its `step` result, null at the end or at a desync. */
  stepOnce(): StepResult | null;
  /**
   * Re-simulates to `frame` (an integer in 0..length), stopping early at a desync. A seek is a
   * jump, not playback: it hands out no events.
   */
  seek(frame: number): void;
}

/** Plays `replay` back by re-simulating it. Starts paused at frame 0; never mutates `replay`. */
export function createReplayPlayer(replay: Replay): ReplayPlayer {
  const length = replay.inputs.length;
  const checksums = new Map(replay.checksums.map((checksum) => [checksum.frame, checksum]));
  let state: SimulationState;
  let digest: number;
  let desync: ReplayDesync | null;
  let paused = true;
  let accumulatedMs = 0;

  const pause = () => {
    paused = true;
    accumulatedMs = 0;
  };

  const verify = () => {
    const expected = checksums.get(state.frame);
    if (!expected) return;
    const actual = { stateHash: hashState(state), inputsHash: formatHash(digest) };
    if (actual.stateHash !== expected.stateHash || actual.inputsHash !== expected.inputsHash) {
      desync = {
        frame: state.frame,
        expected: { stateHash: expected.stateHash, inputsHash: expected.inputsHash },
        actual,
      };
    }
  };

  const rewind = () => {
    state = createInitialState(replay.options);
    digest = EMPTY_INPUTS_DIGEST;
    desync = null;
    verify();
  };

  const tick = (): StepResult | null => {
    const inputs = replay.inputs[state.frame];
    if (desync || !inputs) return null;
    const result = step(state, inputs);
    state = result.state;
    digest = digestInputs(digest, inputs);
    verify();
    return result;
  };

  rewind();

  return {
    get state() {
      return state;
    },
    get frame() {
      return state.frame;
    },
    length,
    get paused() {
      return paused;
    },
    get desync() {
      return desync;
    },
    play() {
      if (!desync && state.frame < length) paused = false;
    },
    pause,
    advance(elapsedMs) {
      if (paused) return [];
      accumulatedMs = Math.min(accumulatedMs + elapsedMs, MAX_CATCH_UP_MS);
      const ticks: StepResult[] = [];
      let result: StepResult | null;
      while (accumulatedMs + EPSILON_MS >= TICK_MS && (result = tick())) {
        accumulatedMs -= TICK_MS;
        ticks.push(result);
      }
      if (desync || state.frame === length) pause();
      return ticks;
    },
    stepOnce: tick,
    seek(frame) {
      if (!Number.isInteger(frame) || frame < 0 || frame > length) {
        throw new RangeError(`Seek frame must be an integer in [0, ${length}], got ${frame}`);
      }
      // ponytail: a backward seek re-simulates from frame 0 (about 6,000 cheap ticks for a 99 s
      // match). Measured in the Replay Lab (Chromium, dev build) on a 5,940-tick replay: a
      // backward slider drag near the end costs 12 ms median, 23 ms worst per change; forward
      // changes cost 3 ms. Keep periodic in-memory snapshots if step cost makes that noticeable.
      if (frame < state.frame) rewind();
      while (state.frame < frame && tick());
      if (desync) pause();
    },
  };
}

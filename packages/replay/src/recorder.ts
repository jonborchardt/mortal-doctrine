import { parseFrameInputs, type FrameInputs } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  DEFAULT_HISTORY_CAPACITY,
  serializeState,
  type InitialStateOptions,
  type InputProvider,
  type SimulationState,
} from '@mortal-doctrine/simulation';
import { REPLAY_VERSION, type Replay, type ReplayChecksum } from './format';
import { digestInputs, EMPTY_INPUTS_DIGEST, formatHash, hashState } from './hash';

export const DEFAULT_CHECKSUM_INTERVAL = 60;

export interface ReplayRecorderConfig {
  /** The options the recorded session was created with. */
  readonly options?: InitialStateOptions;
  /** Ticks between checksums, an integer >= 1. Default 60. */
  readonly checksumInterval?: number;
  /** The live state of the recorded session, e.g. `() => runner.state`. */
  readonly getState: () => SimulationState;
}

export interface ReplayRecorder {
  /** Ticks recorded so far. */
  readonly length: number;
  /** Wraps the host's provider; pass the result to the runner for every tick of the session. */
  provider(inner: InputProvider): InputProvider;
  /** Ends the recording and returns the replay. Later provider calls throw. */
  finish(): Replay;
}

/**
 * Records the inputs a session is stepped with, plus periodic checksums of its live state.
 * Throws unless `getState()` is currently `createInitialState(options)`.
 */
export function createReplayRecorder(config: ReplayRecorderConfig): ReplayRecorder {
  const { getState, checksumInterval = DEFAULT_CHECKSUM_INTERVAL } = config;
  if (!Number.isInteger(checksumInterval) || checksumInterval < 1) {
    throw new RangeError(`checksumInterval must be an integer >= 1, got ${checksumInterval}`);
  }
  const options = {
    seed: config.options?.seed ?? 0,
    historyCapacity: config.options?.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
  };
  if (serializeState(getState()) !== serializeState(createInitialState(options))) {
    throw new Error('Replay recording must start from createInitialState(options)');
  }

  const inputs: FrameInputs[] = [];
  const checksums: ReplayChecksum[] = [];
  let digest = EMPTY_INPUTS_DIGEST;
  let finished = false;

  const checksum = (state: SimulationState) =>
    checksums.push({
      frame: state.frame,
      stateHash: hashState(state),
      inputsHash: formatHash(digest),
    });

  return {
    get length() {
      return inputs.length;
    },
    provider: (inner) => (frame) => {
      if (finished) throw new Error('Replay recorder is finished');
      const state = getState();
      if (frame !== inputs.length || state.frame !== frame) {
        throw new Error(
          `Replay recording is non-contiguous: provider called for frame ${frame} with ` +
            `${inputs.length} ticks recorded and the state at frame ${state.frame}`,
        );
      }
      if (frame > 0 && frame % checksumInterval === 0) checksum(state);
      const frameInputs = parseFrameInputs(inner(frame));
      inputs.push(frameInputs);
      digest = digestInputs(digest, frameInputs);
      return frameInputs;
    },
    finish() {
      if (finished) throw new Error('Replay recorder is finished');
      const state = getState();
      if (state.frame !== inputs.length) {
        throw new Error(
          `Cannot finish replay: the state is at frame ${state.frame} but ${inputs.length} ` +
            'ticks were recorded',
        );
      }
      finished = true;
      checksum(state);
      return { replayVersion: REPLAY_VERSION, options, checksumInterval, inputs, checksums };
    },
  };
}

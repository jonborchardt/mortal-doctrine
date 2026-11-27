import { TICK_MS } from './constants';
import { createInitialState, type FrameInputs, type SimulationState } from './state';
import { step } from './step';

// Caps catch-up after a stall (tab hidden, debugger) so we never run hundreds of ticks at once.
const MAX_CATCH_UP_MS = 250;
// Absorbs floating-point drift so e.g. 3 × (1000/60) ms reliably yields 3 ticks.
const EPSILON_MS = 1e-6;

export interface SimulationRunner {
  readonly state: SimulationState;
  readonly paused: boolean;
  /** Feeds real elapsed time from the host; runs as many whole ticks as have accrued. Returns ticks run. */
  advance(elapsedMs: number, inputs: FrameInputs): number;
  /** Runs exactly one tick regardless of pause state. */
  stepOnce(inputs: FrameInputs): void;
  pause(): void;
  resume(): void;
  reset(): void;
}

/**
 * Fixed-step driver around `step`. It never reads a clock: the host passes elapsed time in,
 * which keeps it headless and deterministic under test.
 */
export function createSimulationRunner(
  initialState: SimulationState = createInitialState(),
): SimulationRunner {
  let state = initialState;
  let paused = false;
  let accumulatedMs = 0;

  return {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    advance(elapsedMs, inputs) {
      if (paused) return 0;
      accumulatedMs = Math.min(accumulatedMs + elapsedMs, MAX_CATCH_UP_MS);
      let ticks = 0;
      while (accumulatedMs + EPSILON_MS >= TICK_MS) {
        state = step(state, inputs);
        accumulatedMs -= TICK_MS;
        ticks++;
      }
      return ticks;
    },
    stepOnce(inputs) {
      state = step(state, inputs);
    },
    pause() {
      paused = true;
      accumulatedMs = 0;
    },
    resume() {
      paused = false;
    },
    reset() {
      state = initialState;
      accumulatedMs = 0;
    },
  };
}

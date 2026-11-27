import { TICK_MS, type FrameInputs } from '@mortal-doctrine/sim-core';
import { createInitialState, type InitialStateOptions, type SimulationState } from './state';
import { step, type SimulationEvent } from './step';

// Caps catch-up after a stall (tab hidden, debugger) so we never run hundreds of ticks at once.
const MAX_CATCH_UP_MS = 250;
// Absorbs floating-point drift so e.g. 3 × (1000/60) ms reliably yields 3 ticks.
const EPSILON_MS = 1e-6;

/** Supplies the inputs for one tick, given the frame about to be processed. */
export type InputProvider = (frame: number) => FrameInputs;

export interface AdvanceResult {
  readonly ticks: number;
  /** Events of every tick run, in tick order. */
  readonly events: readonly SimulationEvent[];
}

export interface SimulationRunner {
  readonly state: SimulationState;
  readonly paused: boolean;
  /**
   * Fraction of a tick accumulated but not yet run, in [0, 1); 0 while paused. Presentation may
   * use it to interpolate between the previous and current snapshot. Never affects state.
   */
  readonly alpha: number;
  /**
   * Feeds real elapsed time from the host and runs as many whole ticks as have accrued, calling
   * `inputs` exactly once per tick. While paused it runs nothing and never calls `inputs`.
   */
  advance(elapsedMs: number, inputs: InputProvider): AdvanceResult;
  /** Runs exactly one tick regardless of pause state; returns its events. */
  stepOnce(inputs: InputProvider): readonly SimulationEvent[];
  pause(): void;
  resume(): void;
  /** Rebuilds `createInitialState(options)`; keeps the pause flag. */
  reset(): void;
}

const NO_EVENTS: readonly SimulationEvent[] = Object.freeze([]);

/**
 * Fixed-step driver around `step`. It never reads a clock: the host passes elapsed time in,
 * which keeps it headless and deterministic under test.
 */
export function createSimulationRunner(options: InitialStateOptions = {}): SimulationRunner {
  let state = createInitialState(options);
  let paused = false;
  let accumulatedMs = 0;

  const tick = (inputs: InputProvider) => {
    const result = step(state, inputs(state.frame));
    state = result.state;
    return result.events;
  };

  return {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    get alpha() {
      // The epsilon can leave the accumulator a hair below zero after a tick.
      return Math.max(0, accumulatedMs / TICK_MS);
    },
    advance(elapsedMs, inputs) {
      if (paused) return { ticks: 0, events: NO_EVENTS };
      accumulatedMs = Math.min(accumulatedMs + elapsedMs, MAX_CATCH_UP_MS);
      let ticks = 0;
      const events: SimulationEvent[] = [];
      while (accumulatedMs + EPSILON_MS >= TICK_MS) {
        events.push(...tick(inputs));
        accumulatedMs -= TICK_MS;
        ticks++;
      }
      return { ticks, events: Object.freeze(events) };
    },
    stepOnce: tick,
    pause() {
      paused = true;
      accumulatedMs = 0;
    },
    resume() {
      paused = false;
    },
    reset() {
      state = createInitialState(options);
      accumulatedMs = 0;
    },
  };
}

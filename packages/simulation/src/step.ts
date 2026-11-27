import { assertInt32, parseFrameInputs, type FrameInputs } from '@mortal-doctrine/sim-core';
import { updateFighters, type BoundaryContactEvent } from './fighters';
import { updateInput } from './input';
import type { SimulationState } from './state';

/** Every event `step` can return. Ordered by phase, then player index, then emission. */
export type SimulationEvent = BoundaryContactEvent;

export interface StepResult {
  readonly state: SimulationState;
  /** A new frozen array every step. */
  readonly events: readonly SimulationEvent[];
}

/**
 * Advances the simulation exactly one tick. Pure: never mutates `state`. Throws, producing no
 * state, unless `inputs` is exactly two valid `InputFrame`s.
 */
export function step(state: SimulationState, inputs: FrameInputs): StepResult {
  const validInputs = parseFrameInputs(inputs);
  const frame = state.frame;
  assertInt32(frame + 1, 'frame');

  // Phase order (also in docs/architecture.md). Each owner sees only a read-only context.
  // 1. Input history: append this tick's raw frames before anything else runs.
  const input = updateInput(state.input, { frame, inputs: validInputs });
  // 2. Walk/bounds: placeholder movement from the resolved direction of the current frame.
  const fighters = updateFighters(state.fighters, {
    frame,
    inputs: validInputs,
    input: input.slice,
  });
  // 3. Collect events in phase order (each phase already orders by player, then emission).
  const events: readonly SimulationEvent[] = Object.freeze([...input.events, ...fighters.events]);

  // The rng slice passes through: no gameplay draws yet (see rng.ts).
  return {
    state: { frame: frame + 1, rng: state.rng, input: input.slice, fighters: fighters.slice },
    events,
  };
}

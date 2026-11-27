import { updateCommands, type CommandEvent, type Facing } from '@mortal-doctrine/commands';
import { updateMovement, type MovementEvent } from '@mortal-doctrine/movement';
import { assertInt32, parseFrameInputs, type FrameInputs } from '@mortal-doctrine/sim-core';
import { updateInput } from './input';
import type { SimulationState } from './state';

/** Every event `step` can return. Ordered by phase, then player index, then emission. */
export type SimulationEvent = CommandEvent | MovementEvent;

export interface StepResult {
  readonly state: SimulationState;
  /** A new frozen array every step. */
  readonly events: readonly SimulationEvent[];
}

/** The stored facing of each fighter, which the next `step` uses for command recognition. */
export function playerFacing(state: SimulationState): readonly [Facing, Facing] {
  const [p0, p1] = state.fighters;
  return [p0.facing === 1 ? 'right' : 'left', p1.facing === 1 ? 'right' : 'left'];
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
  // 2. Commands: recognize definitions from the history with start-of-tick facing.
  const commands = updateCommands(state.commands, {
    frame,
    histories: input.slice.history,
    facing: playerFacing(state),
  });
  // 3. Movement: walk, crouch, jump, walls, separation limit, pushboxes, facing.
  const fighters = updateMovement(state.fighters, {
    frame,
    inputs: validInputs,
    arena: state.arena,
  });
  // 4. Collect events in phase order (each phase already orders by player, then emission).
  const events: readonly SimulationEvent[] = Object.freeze([
    ...input.events,
    ...commands.events,
    ...fighters.events,
  ]);

  // The rng slice passes through: no gameplay draws yet (see rng.ts).
  return {
    state: {
      frame: frame + 1,
      rng: state.rng,
      input: input.slice,
      arena: state.arena,
      fighters: fighters.slice,
      commands: commands.slice,
    },
    events,
  };
}

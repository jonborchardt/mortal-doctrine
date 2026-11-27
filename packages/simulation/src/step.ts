import { ARENA_WIDTH, FIGHTER_WIDTH, WALK_SPEED } from './constants';
import type { FighterState, FrameInputs, PlayerInput, SimulationState } from './state';

const MIN_X = FIGHTER_WIDTH / 2;
const MAX_X = ARENA_WIDTH - FIGHTER_WIDTH / 2;

/** Advances the simulation exactly one tick. Pure: never mutates `state`. */
export function step(state: SimulationState, inputs: FrameInputs): SimulationState {
  return {
    frame: state.frame + 1,
    fighters: [walk(state.fighters[0], inputs[0]), walk(state.fighters[1], inputs[1])],
  };
}

function walk(fighter: FighterState, input: PlayerInput): FighterState {
  const direction = Number(input.right) - Number(input.left);
  return { x: Math.min(MAX_X, Math.max(MIN_X, fighter.x + direction * WALK_SPEED)) };
}

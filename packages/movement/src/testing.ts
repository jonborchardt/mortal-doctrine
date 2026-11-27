// Public test fixtures (`@mortal-doctrine/movement/testing`). Placeholder tuning only, never a
// character's. For tests and labs; production code must not import this entry point.
import { InputBit, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import {
  updateMovement,
  type FighterState,
  type MovementEvent,
  type MovementSlice,
} from './movement';
import {
  DEFAULT_MOVEMENT_PARAMETERS,
  type ArenaRules,
  type MovementParameters,
} from './parameters';

const { LEFT, RIGHT, UP, DOWN } = InputBit;

/**
 * Ramped placeholder set: acceleration (70) and friction (45) smaller than, and not dividing,
 * the walk speeds; forward ≠ back; crouching box wider than standing; landing overshoots y = 0.
 */
export const RAMPED_MOVEMENT_PARAMETERS: MovementParameters = {
  walkForwardSpeed: 500,
  walkBackSpeed: 300,
  walkAcceleration: 70,
  groundFriction: 45,
  jumpVelocity: 1750,
  jumpForwardSpeed: 600,
  jumpBackSpeed: 350,
  gravity: 90,
  pushboxes: {
    standing: { width: 7000, height: 12000 },
    crouching: { width: 8000, height: 7000 },
    airborne: { width: 5000, height: 9000 },
  },
};

export interface ParameterSet {
  readonly id: string;
  readonly name: string;
  readonly params: MovementParameters;
}

export const PARAMETER_SETS: readonly ParameterSet[] = [
  { id: 'default', name: 'Default (instant walk)', params: DEFAULT_MOVEMENT_PARAMETERS },
  { id: 'ramped', name: 'Ramped (acceleration and friction)', params: RAMPED_MOVEMENT_PARAMETERS },
];

export interface MovementScenario {
  readonly id: string;
  readonly name: string;
  /** Ticks worth showing; the inputs are neutral afterwards. */
  readonly frames: number;
  /** Arena rules other than the default. */
  readonly arena?: ArenaRules;
  readonly inputs: (frame: number) => FrameInputs;
}

const solo =
  (frameFor: (frame: number) => InputFrame) =>
  (frame: number): FrameInputs => [frameFor(frame), 0];

/**
 * Player 1 (left, facing right) acts; player 2 stands still unless stated. Start: x 24000 and
 * 72000 in the default 96000 arena.
 */
export const MOVEMENT_SCENARIOS: readonly MovementScenario[] = [
  {
    id: 'walk-forward',
    name: 'Walk forward 40, release',
    frames: 60,
    inputs: solo((f) => (f < 40 ? RIGHT : 0)),
  },
  {
    id: 'walk-back',
    name: 'Walk back 40, release',
    frames: 60,
    inputs: solo((f) => (f < 40 ? LEFT : 0)),
  },
  {
    id: 'crouch',
    name: 'Walk forward 20, crouch 30, stand',
    frames: 60,
    inputs: solo((f) => (f < 20 ? RIGHT : f < 50 ? DOWN : 0)),
  },
  { id: 'neutral-jump', name: 'Neutral jump', frames: 60, inputs: solo((f) => (f === 0 ? UP : 0)) },
  {
    id: 'forward-jump',
    name: 'Forward jump',
    frames: 70,
    inputs: solo((f) => (f === 0 ? UP | RIGHT : 0)),
  },
  {
    id: 'back-jump',
    name: 'Back jump',
    frames: 70,
    inputs: solo((f) => (f === 0 ? UP | LEFT : 0)),
  },
  {
    id: 'corner-push',
    name: 'Corner push: walk into player 2 and push to the right wall',
    frames: 300,
    inputs: solo(() => RIGHT),
  },
  {
    id: 'cross-up',
    name: 'Cross-up: walk in, forward jump over player 2',
    frames: 160,
    inputs: solo((f) => (f < 97 ? RIGHT : f === 97 ? UP | RIGHT : 0)),
  },
  {
    id: 'max-separation',
    name: 'Max separation 60000: walk back, both walk back, back jump',
    frames: 150,
    arena: { width: 96_000, maxSeparation: 60_000 },
    inputs: (f) => {
      if (f < 50) return [LEFT, 0];
      if (f < 80) return [LEFT, RIGHT];
      return [f === 80 ? UP | LEFT : 0, 0];
    },
  },
];

/** Swaps LEFT and RIGHT. */
export function mirrorFrame(frame: InputFrame): InputFrame {
  return (frame & ~(LEFT | RIGHT)) | (frame & LEFT ? RIGHT : 0) | (frame & RIGHT ? LEFT : 0);
}

export function mirrorInputs(inputs: FrameInputs): FrameInputs {
  return [mirrorFrame(inputs[0]), mirrorFrame(inputs[1])];
}

/** x → width − x, vx and facing negated (never −0). */
export function mirrorFighter(fighter: FighterState, width: number): FighterState {
  return {
    ...fighter,
    x: width - fighter.x,
    vx: -fighter.vx || 0,
    facing: fighter.facing === 1 ? -1 : 1,
  };
}

export function mirrorSlice(slice: MovementSlice, width: number): MovementSlice {
  return [mirrorFighter(slice[0], width), mirrorFighter(slice[1], width)];
}

/** Swaps a `wall-contact` side; other events are unchanged. */
export function mirrorEvent<E extends { readonly type: string }>(event: E): E {
  if (!('side' in event)) return event;
  return { ...event, side: event.side === 'left' ? 'right' : 'left' };
}

/** Runs `updateMovement` `count` ticks; returns the slice after every tick and all events. */
export function runMovement(
  slice: MovementSlice,
  arena: ArenaRules,
  inputs: (frame: number) => FrameInputs,
  count: number,
): { slices: MovementSlice[]; events: MovementEvent[] } {
  const slices: MovementSlice[] = [];
  const events: MovementEvent[] = [];
  for (let frame = 0; frame < count; frame++) {
    const result = updateMovement(slice, { frame, inputs: inputs(frame), arena });
    slice = result.slice;
    slices.push(slice);
    events.push(...result.events);
  }
  return { slices, events };
}

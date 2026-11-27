// Public test fixtures (`@mortal-doctrine/commands/testing`). Generic commands only, never a
// character's list. For tests and labs; production code must not import this entry point.
import { InputBit, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import type { CommandDefinition } from './definition';
import {
  createCommandsSlice,
  updateCommands,
  type CommandEvent,
  type CommandsSlice,
  type Facing,
} from './recognizer';

const { LEFT, RIGHT, UP, DOWN, A1, A2, A3, A4, A5, A6 } = InputBit;

export const QUARTER_CIRCLE: CommandDefinition = {
  id: 'quarter-circle',
  motion: ['down', 'down-forward', 'forward'],
  trigger: { buttons: ['A1'], edge: 'press', chordWindow: 0 },
  maxFrames: 12,
};
export const DRAGON_PUNCH: CommandDefinition = {
  id: 'dragon-punch',
  motion: ['forward', 'down', 'down-forward'],
  trigger: { buttons: ['A2'], edge: 'press', chordWindow: 0 },
  maxFrames: 14,
};
export const HALF_CIRCLE: CommandDefinition = {
  id: 'half-circle',
  motion: ['back', 'down-back', 'down', 'down-forward', 'forward'],
  trigger: { buttons: ['A3'], edge: 'press', chordWindow: 0 },
  maxFrames: 20,
};
export const SPIN: CommandDefinition = {
  id: 'spin',
  motion: ['forward', 'down', 'back', 'up'],
  trigger: { buttons: ['A4'], edge: 'press', chordWindow: 0 },
  maxFrames: 30,
};
/** Hold back 30 frames, then forward + A5 within 10 frames of the last held frame. */
export const CHARGE: CommandDefinition = {
  id: 'charge',
  charge: { direction: 'back', frames: 30 },
  motion: ['forward'],
  trigger: { buttons: ['A5'], edge: 'press', chordWindow: 0 },
  maxFrames: 10,
};
export const CHORD: CommandDefinition = {
  id: 'chord',
  trigger: { buttons: ['A1', 'A2'], edge: 'press', chordWindow: 3 },
  maxFrames: 1,
};
export const SAME_FRAME_CHORD: CommandDefinition = {
  id: 'same-frame-chord',
  trigger: { buttons: ['A3', 'A4'], edge: 'press', chordWindow: 0 },
  maxFrames: 1,
};
export const RELEASE: CommandDefinition = {
  id: 'release',
  trigger: { buttons: ['A6'], edge: 'release', chordWindow: 0 },
  maxFrames: 1,
};

/** Every generic command, in priority order. */
export const GENERIC_COMMANDS: readonly CommandDefinition[] = [
  QUARTER_CIRCLE,
  DRAGON_PUNCH,
  HALF_CIRCLE,
  SPIN,
  CHARGE,
  CHORD,
  RELEASE,
];

/** Swaps LEFT and RIGHT: the same relative input for the opposite facing. */
export function mirror(frame: InputFrame): InputFrame {
  const swapped = (frame & LEFT ? RIGHT : 0) | (frame & RIGHT ? LEFT : 0);
  return (frame & ~(LEFT | RIGHT)) | swapped;
}

export interface MotionCase {
  readonly definition: CommandDefinition;
  /** One raw frame per motion step for facing right. */
  readonly steps: readonly InputFrame[];
  readonly button: InputFrame;
}

export const MOTION_CASES: readonly MotionCase[] = [
  { definition: QUARTER_CIRCLE, steps: [DOWN, DOWN | RIGHT, RIGHT], button: A1 },
  { definition: DRAGON_PUNCH, steps: [RIGHT, DOWN, DOWN | RIGHT], button: A2 },
  {
    definition: HALF_CIRCLE,
    steps: [LEFT, DOWN | LEFT, DOWN, DOWN | RIGHT, RIGHT],
    button: A3,
  },
  { definition: SPIN, steps: [RIGHT, DOWN, LEFT, UP], button: A4 },
];

/**
 * `span` frames: the first step on frame 0, the last step plus `button` on frame `span - 1`, the
 * second-to-last step held in between.
 */
export function spanned(
  steps: readonly InputFrame[],
  button: InputFrame,
  span: number,
): InputFrame[] {
  const head = steps.slice(0, -1);
  const last = steps.at(-1) ?? 0;
  const filler = head.at(-1) ?? 0;
  return [...head, ...Array.from({ length: span - steps.length }, () => filler), last | button];
}

/** Recognizer state plus the input history it reads: a minimal stand-in for `step`. */
export interface CommandRun {
  readonly frame: number;
  readonly capacity: number;
  readonly slice: CommandsSlice;
  readonly histories: readonly [readonly InputFrame[], readonly InputFrame[]];
}

export function startRun(definitions: unknown, historyCapacity = 60): CommandRun {
  return {
    frame: 0,
    capacity: historyCapacity,
    slice: createCommandsSlice(definitions, historyCapacity),
    histories: [[], []],
  };
}

/** Appends each tick's inputs to bounded histories and runs `updateCommands`. */
export function advanceRun(
  run: CommandRun,
  inputs: readonly FrameInputs[],
  facing: readonly [Facing, Facing] = ['right', 'left'],
): { run: CommandRun; events: CommandEvent[] } {
  const events: CommandEvent[] = [];
  for (const tick of inputs) {
    const histories = [
      [...run.histories[0], tick[0]].slice(-run.capacity),
      [...run.histories[1], tick[1]].slice(-run.capacity),
    ] as const;
    const result = updateCommands(run.slice, { frame: run.frame, histories, facing });
    events.push(...result.events);
    run = { frame: run.frame + 1, capacity: run.capacity, slice: result.slice, histories };
  }
  return { run, events };
}

/** Player 0 frames only; player 1 stays neutral. */
export function soloInputs(frames: readonly InputFrame[]): FrameInputs[] {
  return frames.map((frame) => [frame, 0]);
}

export interface CommandScript {
  readonly id: string;
  readonly name: string;
  /** Player 0 enters the input, player 1 (facing left) its mirror. */
  readonly inputs: readonly FrameInputs[];
}

const LEAD = 2;
const TAIL = 6;

function bothPlayers(id: string, name: string, frames: readonly InputFrame[]): CommandScript {
  const padded = [
    ...Array<InputFrame>(LEAD).fill(0),
    ...frames,
    ...Array<InputFrame>(TAIL).fill(0),
  ];
  return { id, name, inputs: padded.map((frame) => [frame, mirror(frame)]) };
}

/**
 * Scripted fixtures for `GENERIC_COMMANDS` (Command Lab, simulation tests). Short enough that
 * the fighters never cross, so default facing stays player 0 right, player 1 left.
 */
export const COMMAND_SCRIPTS: readonly CommandScript[] = [
  bothPlayers('quarter-circle', 'Quarter-circle + A1', [DOWN, DOWN | RIGHT, RIGHT | A1]),
  bothPlayers('dragon-punch', 'Dragon punch + A2', [RIGHT, DOWN, DOWN | RIGHT | A2]),
  bothPlayers('half-circle', 'Half-circle + A3', [
    LEFT,
    DOWN | LEFT,
    DOWN,
    DOWN | RIGHT,
    RIGHT | A3,
  ]),
  bothPlayers('spin', '360 + A4', [RIGHT, DOWN, LEFT, UP | A4]),
  bothPlayers('charge', 'Charge back, forward + A5', [
    ...Array<InputFrame>(30).fill(LEFT),
    RIGHT | A5,
  ]),
  bothPlayers('chord', 'Chord A1 then A2 three frames later', [A1, A1, A1, A1 | A2]),
  bothPlayers('release', 'Hold A6, release', [A6, A6, A6, A6, A6, 0]),
];

const CYCLE = COMMAND_SCRIPTS.flatMap((script) => script.inputs);

/** Every command script back to back, repeating: `(frame) => FrameInputs`. */
export function commandCycleScript(frame: number): FrameInputs {
  return CYCLE[frame % CYCLE.length] ?? [0, 0];
}

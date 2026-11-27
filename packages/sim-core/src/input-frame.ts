import { z } from 'zod';

/** Bit flags of an `InputFrame`. Bits are append-only: never renumber an existing one. */
export const InputBit = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  UP: 1 << 2,
  DOWN: 1 << 3,
  A1: 1 << 4,
  A2: 1 << 5,
  A3: 1 << 6,
  A4: 1 << 7,
  A5: 1 << 8,
  A6: 1 << 9,
} as const;

export type InputBitName = keyof typeof InputBit;

/**
 * One player's raw input for one tick: a bitmask of `InputBit`s. Raw frames may contain
 * opposing directions; use `resolveDirection` for gameplay direction.
 */
export type InputFrame = number;

/** No buttons held. Idle, absent and disconnected players all supply this. */
export const NEUTRAL_INPUT: InputFrame = 0;

const ALL_BITS = Object.values(InputBit).reduce((mask, bit) => mask | bit, 0);

/** Non-negative integer with no bit above bit 9 set. */
export const inputFrameSchema = z
  .int()
  .min(0)
  .max(ALL_BITS, { message: 'input frame sets a bit above bit 9' });

/** Exactly one `InputFrame` per player, player 0 first. */
export type FrameInputs = readonly [InputFrame, InputFrame];

export const frameInputsSchema = z.tuple([inputFrameSchema, inputFrameSchema]).readonly();

/** Returns `value` as `FrameInputs` or throws a descriptive error naming the failing entry. */
export function parseFrameInputs(value: unknown): FrameInputs {
  // Per-tick hot path: plain checks equivalent to the schema; Zod only builds the error.
  const isFrame = (frame: unknown) =>
    Number.isInteger(frame) && (frame as number) >= 0 && (frame as number) <= ALL_BITS;
  if (Array.isArray(value) && value.length === 2 && isFrame(value[0]) && isFrame(value[1])) {
    return value as unknown as FrameInputs;
  }
  const result = frameInputsSchema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) =>
      `${issue.path.length > 0 ? `[${issue.path.join('.')}]` : 'inputs'}: ${issue.message}`,
  );
  throw new TypeError(
    `Invalid FrameInputs (expected exactly two InputFrames): ${problems.join('; ')}`,
  );
}

/** Gameplay direction derived from a raw frame. +x is right, +y is up. */
export interface ResolvedDirection {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

/**
 * The single opposing-direction policy: left + right resolves to no horizontal direction;
 * up + down resolves to up. Every gameplay consumer uses this; none resolves directions itself.
 */
export function resolveDirection(frame: InputFrame): ResolvedDirection {
  const left = (frame & InputBit.LEFT) !== 0;
  const right = (frame & InputBit.RIGHT) !== 0;
  const up = (frame & InputBit.UP) !== 0;
  const down = (frame & InputBit.DOWN) !== 0;
  return { x: left === right ? 0 : right ? 1 : -1, y: up ? 1 : down ? -1 : 0 };
}

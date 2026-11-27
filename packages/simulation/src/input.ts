// Owner of the `input` slice: bounded gameplay input history of raw frames.
import { inputFrameSchema, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import { z } from 'zod';

export const DEFAULT_HISTORY_CAPACITY = 60;
export const MAX_HISTORY_CAPACITY = 600;

const historySchema = z.array(inputFrameSchema).readonly();

export const inputSliceSchema = z
  .object({
    capacity: z.int().min(1).max(MAX_HISTORY_CAPACITY),
    /** Raw frames per player, oldest first; the newest is the frame being processed. */
    history: z.tuple([historySchema, historySchema]).readonly(),
  })
  .superRefine((slice, ctx) => {
    slice.history.forEach((frames, player) => {
      if (frames.length > slice.capacity) {
        ctx.addIssue({
          code: 'custom',
          path: ['history', player],
          message: `holds ${frames.length} frames, more than capacity ${slice.capacity}`,
        });
      }
    });
  })
  .readonly();

export type InputSlice = z.infer<typeof inputSliceSchema>;

export function initialInput(capacity: number = DEFAULT_HISTORY_CAPACITY): InputSlice {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_HISTORY_CAPACITY) {
    throw new RangeError(
      `historyCapacity must be an integer in [1, ${MAX_HISTORY_CAPACITY}], got ${capacity}`,
    );
  }
  return { capacity, history: [[], []] };
}

/** Appends this tick's raw frames, dropping the oldest once a history is at capacity. */
export function updateInput(
  slice: InputSlice,
  context: { readonly frame: number; readonly inputs: FrameInputs },
): { readonly slice: InputSlice; readonly events: readonly never[] } {
  const append = (frames: readonly InputFrame[], frame: InputFrame) =>
    [...frames, frame].slice(-slice.capacity);
  return {
    slice: {
      capacity: slice.capacity,
      history: [
        append(slice.history[0], context.inputs[0]),
        append(slice.history[1], context.inputs[1]),
      ],
    },
    events: [],
  };
}

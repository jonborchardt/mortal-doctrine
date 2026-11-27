// Owner of the `fighters` slice: placeholder walking and arena bounds.
import {
  int32Schema,
  resolveDirection,
  SUBUNITS_PER_UNIT,
  type FrameInputs,
  type SimulationEventEnvelope,
} from '@mortal-doctrine/sim-core';
import { z } from 'zod';
import { ARENA_WIDTH, FIGHTER_WIDTH, WALK_SPEED } from './constants';
import type { InputSlice } from './input';

const MIN_X = FIGHTER_WIDTH / 2;
const MAX_X = ARENA_WIDTH - FIGHTER_WIDTH / 2;

export const fighterStateSchema = z.object({ x: int32Schema }).readonly();
export const fightersSliceSchema = z.tuple([fighterStateSchema, fighterStateSchema]).readonly();

export type FighterState = z.infer<typeof fighterStateSchema>;
export type FightersSlice = z.infer<typeof fightersSliceSchema>;

/** First tick a fighter's x reaches an arena edge it was not already at. */
export interface BoundaryContactEvent extends SimulationEventEnvelope<'boundary-contact'> {
  readonly player: 0 | 1;
  readonly side: 'left' | 'right';
}

export function initialFighters(): FightersSlice {
  return [{ x: 240 * SUBUNITS_PER_UNIT }, { x: 720 * SUBUNITS_PER_UNIT }];
}

/**
 * Walks each fighter by the resolved direction of its current raw frame, read from the input
 * history (which already holds this tick's frame), and clamps to the arena.
 */
export function updateFighters(
  slice: FightersSlice,
  context: { readonly frame: number; readonly inputs: FrameInputs; readonly input: InputSlice },
): { readonly slice: FightersSlice; readonly events: readonly BoundaryContactEvent[] } {
  const events: BoundaryContactEvent[] = [];
  const walk = (player: 0 | 1): FighterState => {
    const current = context.input.history[player].at(-1);
    if (current === undefined) throw new Error('walk phase ran before input history was appended');
    const { x } = slice[player];
    const next = Math.min(MAX_X, Math.max(MIN_X, x + resolveDirection(current).x * WALK_SPEED));
    if (next !== x && (next === MIN_X || next === MAX_X)) {
      const side = next === MIN_X ? 'left' : 'right';
      events.push(Object.freeze({ type: 'boundary-contact', frame: context.frame, player, side }));
    }
    return { x: next };
  };
  return { slice: [walk(0), walk(1)], events };
}

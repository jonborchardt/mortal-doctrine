// Owner of the `rng` slice.
import { createRngState, rngStateSchema, type RngState } from '@mortal-doctrine/sim-core';

export const rngSliceSchema = rngStateSchema;
export type RngSlice = RngState;

export function initialRng(seed?: number): RngSlice {
  return createRngState(seed);
}

/**
 * No gameplay draws random numbers yet, so the slice passes through unchanged and `step` has no
 * RNG phase. The first gameplay consumer adds the phase here; nothing else may draw from it.
 */
export const updateRng: (
  slice: RngSlice,
  context: { readonly frame: number },
) => { readonly slice: RngSlice; readonly events: readonly never[] } = (slice) => ({
  slice,
  events: [],
});

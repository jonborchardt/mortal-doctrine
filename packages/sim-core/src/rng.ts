import { z } from 'zod';
import { int32Schema } from './numeric';

// mulberry32 (Tommy Ettinger, public domain), as pure functions over serializable state.

/** RNG state: the 32-bit generator word, stored reinterpreted as a signed int32. */
export const rngStateSchema = z.object({ state: int32Schema }).readonly();
export type RngState = z.infer<typeof rngStateSchema>;

export const DEFAULT_SEED = 0;
const SEED_MAX = 0xffff_ffff;
const TWO_POW_32 = 0x1_0000_0000;

/** Every integer in [0, 2^32 - 1] is a valid seed, including 0. Others throw. */
export function createRngState(seed: number = DEFAULT_SEED): RngState {
  if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
    throw new RangeError(`RNG seed must be an integer in [0, ${SEED_MAX}], got ${seed}`);
  }
  return { state: seed | 0 };
}

/** Draws the next unsigned 32-bit integer in [0, 2^32 - 1]. */
export function nextUint32(rng: RngState): { readonly rng: RngState; readonly value: number } {
  const state = (rng.state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { rng: { state }, value: (t ^ (t >>> 14)) >>> 0 };
}

/**
 * Draws an integer in [0, bound), `bound` an integer in [1, 2^32]. Unbiased: draws that fall in
 * the incomplete final block of `bound` values are rejected and redrawn, so the number of draws
 * consumed depends only on the state and `bound`.
 */
export function nextBelow(
  rng: RngState,
  bound: number,
): { readonly rng: RngState; readonly value: number } {
  if (!Number.isInteger(bound) || bound < 1 || bound > TWO_POW_32) {
    throw new RangeError(`bound must be an integer in [1, ${TWO_POW_32}], got ${bound}`);
  }
  const limit = TWO_POW_32 - (TWO_POW_32 % bound);
  for (;;) {
    const draw = nextUint32(rng);
    rng = draw.rng;
    if (draw.value < limit) return { rng, value: draw.value % bound };
  }
}

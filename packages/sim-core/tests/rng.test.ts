import { describe, expect, it } from 'vitest';
import {
  createRngState,
  DEFAULT_SEED,
  nextBelow,
  nextUint32,
  rngStateSchema,
  type RngState,
} from '../src/index';

function draw(rng: RngState, count: number): { rng: RngState; values: number[] } {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const next = nextUint32(rng);
    rng = next.rng;
    values.push(next.value);
  }
  return { rng, values };
}

// Pinned forever. Cross-checked against the published mulberry32 reference
// (bryc/code PRNGs.md: `mulberry32(0)()` = 0.26642920868471265 = 1144304738 / 2^32).
const GOLDEN: Record<number, number[]> = {
  0: [1144304738, 1416247, 958946056, 627933444, 2007157716, 2340967985, 2642484575, 2787370982],
  1: [2693262067, 11749833, 2265367787, 4213581821, 4159151403, 1207330352, 2632122864, 3095568220],
  4294967295: [
    3850105811, 813802916, 3073704848, 4054706436, 3630262831, 2315588663, 2922715533, 2042566601,
  ],
};

describe('rng', () => {
  it('matches the pinned golden sequences for seeds 0, 1 and 2^32 - 1', () => {
    for (const [seed, expected] of Object.entries(GOLDEN)) {
      expect(draw(createRngState(Number(seed)), 8).values).toEqual(expected);
    }
  });

  it('defaults to seed 0', () => {
    expect(DEFAULT_SEED).toBe(0);
    expect(createRngState()).toEqual(createRngState(0));
  });

  it('accepts every integer seed and stores the state as int32', () => {
    // Sampled across the range, plus both ends and the signed/unsigned crossover.
    const seeds = [0, 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1];
    for (let seed = 0; seed < 2 ** 32; seed += 99_991_234) seeds.push(seed);
    for (const seed of seeds) {
      const rng = createRngState(seed);
      expect(rngStateSchema.safeParse(rng).success).toBe(true);
      expect(rng.state >>> 0).toBe(seed);
      const { rng: after, values } = draw(rng, 4);
      expect(rngStateSchema.safeParse(after).success).toBe(true);
      for (const value of values) {
        expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32).toBe(true);
      }
    }
    expect(createRngState(2 ** 32 - 1)).toEqual({ state: -1 });
  });

  it('rejects non-integer, negative and too-large seeds', () => {
    for (const bad of [0.5, -1, 2 ** 32, Number.NaN, Infinity]) {
      expect(() => createRngState(bad)).toThrow(/RNG seed must be an integer in \[0, 4294967295\]/);
    }
  });

  it('draws bounded integers in [0, bound) and rejects bad bounds', () => {
    let rng = createRngState(7);
    for (const bound of [1, 2, 3, 6, 10, 1000, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 200; i++) {
        const next = nextBelow(rng, bound);
        rng = next.rng;
        expect(Number.isInteger(next.value) && next.value >= 0 && next.value < bound).toBe(true);
      }
    }
    expect(nextBelow(createRngState(0), 1).value).toBe(0);
    // A power of two never rejects, so it consumes exactly one draw.
    expect(nextBelow(createRngState(0), 2 ** 32)).toEqual(nextUint32(createRngState(0)));
    for (const bad of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN]) {
      expect(() => nextBelow(createRngState(0), bad)).toThrow(/bound must be an integer/);
    }
  });

  it('resumes identically from a state serialized mid-sequence', () => {
    const { rng: midway } = draw(createRngState(123_456), 37);
    const restored = rngStateSchema.parse(JSON.parse(JSON.stringify(midway)));
    expect(draw(restored, 20).values).toEqual(draw(createRngState(123_456), 57).values.slice(37));
  });
});

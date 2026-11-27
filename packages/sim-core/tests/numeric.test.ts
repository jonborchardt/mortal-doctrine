import { describe, expect, it } from 'vitest';
import {
  assertInt32,
  decelerate,
  divTrunc,
  INT32_MAX,
  INT32_MIN,
  int32Schema,
  scaleRatio,
  SUBUNITS_PER_UNIT,
} from '../src/index';

// Symmetry table: includes the int32 limits and their negations (all safe integers).
const VALUES = [0, 1, 2, 7, 99, 100, 101, 12_345, 999_999, INT32_MAX, -INT32_MIN, INT32_MIN];

describe('int32 convention', () => {
  it('uses 100 sub-units per world unit', () => {
    expect(SUBUNITS_PER_UNIT).toBe(100);
  });

  it('accepts exactly the signed 32-bit integers', () => {
    for (const ok of [0, -1, INT32_MIN, INT32_MAX])
      expect(int32Schema.safeParse(ok).success).toBe(true);
    for (const bad of [0.5, INT32_MIN - 1, INT32_MAX + 1, Number.NaN, Infinity]) {
      expect(int32Schema.safeParse(bad).success).toBe(false);
      expect(() => assertInt32(bad, 'x')).toThrow(/x must be an int32/);
    }
    expect(() => assertInt32(INT32_MAX)).not.toThrow();
  });
});

describe('divTrunc', () => {
  it('truncates toward zero', () => {
    expect(divTrunc(7, 2)).toBe(3);
    expect(divTrunc(-7, 2)).toBe(-3);
    expect(divTrunc(7, -2)).toBe(-3);
    expect(divTrunc(-7, -2)).toBe(3);
    expect(divTrunc(1, 3)).toBe(0);
    expect(Object.is(divTrunc(-1, 3), 0)).toBe(true); // never -0
    expect(divTrunc(INT32_MIN, 1)).toBe(INT32_MIN);
    expect(divTrunc(INT32_MAX, 100)).toBe(21_474_836);
    // Exact even where floating-point division would round up to an integer.
    expect(divTrunc(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toBe(1);
  });

  it('is sign-symmetric over the table', () => {
    for (const x of VALUES) {
      for (const d of [1, 2, 3, 7, 100, 4096, INT32_MAX]) {
        expect(divTrunc(-x, d)).toBe(-divTrunc(x, d) + 0);
      }
    }
  });

  it('rejects a zero denominator and non-integers', () => {
    expect(() => divTrunc(1, 0)).toThrow('denominator must not be 0');
    expect(() => divTrunc(1.5, 2)).toThrow('numerator must be a safe integer, got 1.5');
    expect(() => divTrunc(2, 0.5)).toThrow('denominator must be a safe integer, got 0.5');
    expect(() => divTrunc(2 ** 53, 2)).toThrow(/safe integer/);
  });
});

describe('scaleRatio', () => {
  it('truncates value * num / den toward zero and is sign-symmetric', () => {
    expect(scaleRatio(1000, 9, 10)).toBe(900);
    expect(scaleRatio(15, 2, 3)).toBe(10);
    expect(scaleRatio(16, 2, 3)).toBe(10);
    expect(scaleRatio(-16, 2, 3)).toBe(-10);
    // int32 values times ratios up to 2^21 stay safe (2^31 * 2^21 < 2^53).
    expect(scaleRatio(INT32_MAX, 2 ** 21, 2 ** 21)).toBe(INT32_MAX);
    expect(scaleRatio(INT32_MIN, 999_999, 1_000_000)).toBe(-2_147_481_500);
    for (const x of VALUES) {
      for (const [n, d] of [
        [9, 10],
        [2, 3],
        [15, 16],
        [7, 1],
        [1, 100],
      ] as const) {
        expect(scaleRatio(-x, n, d)).toBe(-scaleRatio(x, n, d) + 0);
      }
    }
  });

  it('throws on an unsafe intermediate, a zero denominator or a non-integer', () => {
    expect(() => scaleRatio(INT32_MAX, INT32_MAX * 4096, 1)).toThrow(
      /intermediate .* exceeds Number.MAX_SAFE_INTEGER/,
    );
    expect(() => scaleRatio(2 ** 26, 2 ** 26, 1)).not.toThrow();
    expect(() => scaleRatio(1, 1, 0)).toThrow('denominator must not be 0');
    expect(() => scaleRatio(0.5, 1, 1)).toThrow('value must be a safe integer');
    expect(() => scaleRatio(1, 0.5, 1)).toThrow('numerator must be a safe integer');
    expect(() => scaleRatio(1, 1, 1.5)).toThrow('denominator must be a safe integer');
  });

  it('keeps repeated fractional scaling within den / (den - num) of the exact result', () => {
    // Each truncation loses < 1 and earlier losses shrink by num/den, so the total error is
    // below 1 / (1 - num/den) however many times the scale is applied: it never accumulates.
    for (const [num, den] of [
      [9, 10],
      [15, 16],
      [1, 2],
    ] as const) {
      const bound = BigInt(den) / BigInt(den - num) + 1n;
      for (const start of [1_000_000, -1_000_000, INT32_MAX]) {
        let value = start;
        for (let k = 1; k <= 200; k++) {
          value = scaleRatio(value, num, den);
          // error * den^k = |start * num^k - value * den^k|, computed exactly.
          const scaledError =
            BigInt(start) * BigInt(num) ** BigInt(k) - BigInt(value) * BigInt(den) ** BigInt(k);
          const error = scaledError < 0n ? -scaledError : scaledError;
          expect(error < bound * BigInt(den) ** BigInt(k)).toBe(true);
        }
      }
    }
  });
});

describe('decelerate', () => {
  it('moves toward zero and clamps at zero', () => {
    expect(decelerate(100, 30)).toBe(70);
    expect(decelerate(20, 30)).toBe(0);
    expect(decelerate(-20, 30)).toBe(0);
    expect(decelerate(-100, 30)).toBe(-70);
    expect(decelerate(0, 30)).toBe(0);
    expect(() => decelerate(1, -1)).toThrow('amount must be >= 0');
    expect(() => decelerate(1.5, 1)).toThrow('velocity must be a safe integer');
  });
});

/** The documented M1.05 movement pattern (see README): integer additions plus clamped decay. */
function simulateJump(direction: 1 | -1, frames: number) {
  const ACCEL = 50; // sub-units / frame²
  const MAX_SPEED = 600; // sub-units / frame
  const FRICTION = 35; // sub-units / frame² while not accelerating
  const GRAVITY = -90; // sub-units / frame²
  const ACCEL_FRAMES = 20;

  let x = 0;
  let vx = 0;
  let y = 0;
  let vy = 2400;
  const trace: { x: number; vx: number; y: number; vy: number }[] = [];
  for (let frame = 0; frame < frames; frame++) {
    vx =
      frame < ACCEL_FRAMES
        ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vx + direction * ACCEL))
        : decelerate(vx, FRICTION);
    vy += GRAVITY;
    x += vx;
    y += vy;
    trace.push({ x, vx, y, vy });
  }
  return trace;
}

describe('acceleration, gravity and friction pattern', () => {
  const FRAMES = 600;
  const right = simulateJump(1, FRAMES);

  it('follows the closed form exactly, with no drift', () => {
    right.forEach(({ y, vy }, index) => {
      const n = index + 1;
      expect(vy).toBe(2400 - 90 * n);
      expect(y).toBe(2400 * n - (90 * n * (n + 1)) / 2);
    });
    // Accelerates 50/frame to the 600 cap (frame 12), holds it, then friction brings it to 0.
    expect(right[11]?.vx).toBe(600);
    expect(right[19]?.vx).toBe(600);
    const stopped = right.findIndex(({ vx }) => vx === 0);
    // 600 / 35 = 17.14 -> 18 friction frames after the 20 acceleration frames.
    expect(stopped).toBe(37);
    expect(right.slice(stopped).every(({ vx }) => vx === 0)).toBe(true);
    // Position: 50 * (1 + ... + 12) + 600 * 8 + friction sum (565 + 530 + ... + 5) = 3900 + 4800 + 4845.
    expect(right[FRAMES - 1]?.x).toBe(13_545);
  });

  it('mirrors exactly when the direction is negated', () => {
    const left = simulateJump(-1, FRAMES);
    left.forEach((sample, index) => {
      expect(sample.x).toBe(-(right[index]?.x ?? NaN) + 0);
      expect(sample.vx).toBe(-(right[index]?.vx ?? NaN) + 0);
      expect(sample.y).toBe(right[index]?.y);
    });
  });
});

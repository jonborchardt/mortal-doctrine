import { createRngState, nextUint32 } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import {
  apply,
  compose,
  degToRad,
  IDENTITY,
  invert,
  lerp,
  lerpAngle,
  lerpVec2,
  radToDeg,
  transformFromTrs,
  type Transform,
  type Vec2,
} from '../src/index';

/** The epsilon documented in the README, valid for the input ranges generated below. */
const EPSILON = 1e-9;
const SAMPLES = 2000;
const TAU = 2 * Math.PI;

/** Seeded source of uniform floats; every test owns one, so test order does not matter. */
function seeded(seed: number) {
  let rng = createRngState(seed);
  const range = (min: number, max: number): number => {
    const draw = nextUint32(rng);
    rng = draw.rng;
    return min + (draw.value / 0x1_0000_0000) * (max - min);
  };
  const point = (): Vec2 => ({ x: range(-1000, 1000), y: range(-1000, 1000) });
  // Scale magnitude in [0.1, 10] with a random sign per axis (mirroring included).
  const scale = (): number => range(0.1, 10) * (range(0, 1) < 0.5 ? -1 : 1);
  const transform = (): Transform =>
    transformFromTrs(point(), range(-2 * TAU, 2 * TAU), { x: scale(), y: scale() });
  return { range, point, transform };
}

const FIELDS = ['a', 'b', 'c', 'd', 'tx', 'ty'] as const;

/** Largest absolute difference, relative to the largest expected magnitude (at least 1). */
function transformError(actual: Transform, expected: Transform): number {
  let error = 0;
  let magnitude = 1;
  for (const f of FIELDS) {
    error = Math.max(error, Math.abs(actual[f] - expected[f]));
    magnitude = Math.max(magnitude, Math.abs(expected[f]));
  }
  return error / magnitude;
}

function pointError(actual: Vec2, expected: Vec2): number {
  const magnitude = Math.max(1, Math.abs(expected.x), Math.abs(expected.y));
  return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y)) / magnitude;
}

function mustInvert(t: Transform): Transform {
  const inverse = invert(t);
  if (inverse === null) throw new Error('expected an invertible transform');
  return inverse;
}

describe('transform properties over seeded inputs', () => {
  it('identity is neutral on both sides, exactly', () => {
    const gen = seeded(1);
    for (let i = 0; i < SAMPLES; i++) {
      const t = gen.transform();
      expect(compose(IDENTITY, t)).toEqual(t);
      expect(compose(t, IDENTITY)).toEqual(t);
    }
  });

  it('compose applies the child first, then the parent', () => {
    const gen = seeded(2);
    for (let i = 0; i < SAMPLES; i++) {
      const parent = gen.transform();
      const child = gen.transform();
      const p = gen.point();
      const expected = apply(parent, apply(child, p));
      expect(pointError(apply(compose(parent, child), p), expected)).toBeLessThan(EPSILON);
    }
  });

  it('a transform composed with its inverse is the identity, on both sides', () => {
    const gen = seeded(3);
    for (let i = 0; i < SAMPLES; i++) {
      const t = gen.transform();
      const inverse = mustInvert(t);
      for (const f of FIELDS) expect(Number.isFinite(inverse[f])).toBe(true);
      expect(transformError(compose(t, inverse), IDENTITY)).toBeLessThan(EPSILON);
      expect(transformError(compose(inverse, t), IDENTITY)).toBeLessThan(EPSILON);
    }
  });

  it('the inverse maps a transformed point back', () => {
    const gen = seeded(4);
    for (let i = 0; i < SAMPLES; i++) {
      const t = gen.transform();
      const p = gen.point();
      expect(pointError(apply(mustInvert(t), apply(t, p)), p)).toBeLessThan(EPSILON);
    }
  });

  it('composition is associative', () => {
    const gen = seeded(5);
    for (let i = 0; i < SAMPLES; i++) {
      const a = gen.transform();
      const b = gen.transform();
      const c = gen.transform();
      const left = compose(compose(a, b), c);
      expect(transformError(left, compose(a, compose(b, c)))).toBeLessThan(EPSILON);
    }
  });
});

describe('invert edge cases', () => {
  it.each([
    ['x', { x: 0, y: 2 }],
    ['y', { x: 2, y: 0 }],
    ['both axes', { x: 0, y: 0 }],
    ['x (negative zero)', { x: -0, y: 3 }],
  ])('returns null for zero scale on %s', (_name, scale) => {
    const gen = seeded(6);
    for (let i = 0; i < 100; i++) {
      expect(invert(transformFromTrs(gen.point(), gen.range(-TAU, TAU), scale))).toBeNull();
    }
  });

  it('returns null rather than non-finite values when the determinant underflows', () => {
    expect(invert(transformFromTrs({ x: 1, y: 2 }, 0.3, { x: 1e-200, y: 1e-200 }))).toBeNull();
  });

  it('inverts a mirroring (negative) scale', () => {
    const mirror = transformFromTrs({ x: 5, y: -3 }, degToRad(30), { x: -1, y: 1 });
    const inverse = mustInvert(mirror);
    expect(transformError(compose(inverse, mirror), IDENTITY)).toBeLessThan(EPSILON);
    const p = { x: 7, y: 11 };
    expect(pointError(apply(inverse, apply(mirror, p)), p)).toBeLessThan(EPSILON);
  });
});

describe('angle convention: y-up, counter-clockwise positive', () => {
  const S = Math.SQRT1_2;

  it.each([
    [90, 0, 1],
    [45, S, S],
    [135, -S, S],
    [225, -S, -S],
    [315, S, -S],
    [-45, S, -S],
    [-135, -S, -S],
  ])('rotating (1, 0) by %d degrees gives (%f, %f)', (degrees, x, y) => {
    const rotation = transformFromTrs({ x: 0, y: 0 }, degToRad(degrees), { x: 1, y: 1 });
    const rotated = apply(rotation, { x: 1, y: 0 });
    expect(pointError(rotated, { x, y })).toBeLessThan(EPSILON);
    // Quadrant signs (skipped for the on-axis 90 degree case, where x is only ~0).
    if (x !== 0) expect(Math.sign(rotated.x)).toBe(Math.sign(x));
    expect(Math.sign(rotated.y)).toBe(Math.sign(y));
  });

  it('builds scale, then rotation, then translation', () => {
    const t = transformFromTrs({ x: 10, y: 0 }, degToRad(90), { x: 2, y: 1 });
    // (1,0) -scale-> (2,0) -rotate-> (0,2) -translate-> (10,2).
    // Rotate-then-scale would give (10,1); translating first would move the point off x = 10.
    expect(pointError(apply(t, { x: 1, y: 0 }), { x: 10, y: 2 })).toBeLessThan(EPSILON);
  });

  it('converts degrees and radians exactly at 0 and 180, and round-trips', () => {
    expect(degToRad(0)).toBe(0);
    expect(radToDeg(0)).toBe(0);
    expect(degToRad(180)).toBe(Math.PI);
    expect(radToDeg(Math.PI)).toBe(180);
    expect(degToRad(-180)).toBe(-Math.PI);
    const gen = seeded(7);
    for (let i = 0; i < SAMPLES; i++) {
      const degrees = gen.range(-720, 720);
      expect(Math.abs(radToDeg(degToRad(degrees)) - degrees)).toBeLessThan(EPSILON);
    }
  });
});

describe('interpolation', () => {
  it('lerp and lerpVec2 hit both endpoints exactly', () => {
    const gen = seeded(8);
    for (let i = 0; i < SAMPLES; i++) {
      const a = gen.point();
      const b = gen.point();
      expect(lerp(a.x, b.x, 0)).toBe(a.x);
      expect(lerp(a.x, b.x, 1)).toBe(b.x);
      expect(lerpVec2(a, b, 0)).toEqual(a);
      expect(lerpVec2(a, b, 1)).toEqual(b);
    }
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(lerpVec2({ x: 0, y: 10 }, { x: 4, y: -10 }, 0.5)).toEqual({ x: 2, y: 0 });
  });

  it('lerpAngle crosses the 180 degree boundary instead of going through 0', () => {
    expect(radToDeg(lerpAngle(degToRad(170), degToRad(-170), 0.5))).toBeCloseTo(180, 9);
    expect(radToDeg(lerpAngle(degToRad(-170), degToRad(170), 0.5))).toBeCloseTo(-180, 9);
    expect(radToDeg(lerpAngle(degToRad(170), degToRad(-170), 0.25))).toBeCloseTo(175, 9);
    // Away from the boundary it is an ordinary lerp.
    expect(radToDeg(lerpAngle(degToRad(10), degToRad(50), 0.5))).toBeCloseTo(30, 9);
  });

  it('lerpAngle never sweeps more than half a turn, for inputs in any range', () => {
    const gen = seeded(9);
    for (let i = 0; i < SAMPLES; i++) {
      const a = gen.range(-10 * TAU, 10 * TAU);
      const b = gen.range(-10 * TAU, 10 * TAU);
      expect(lerpAngle(a, b, 0)).toBe(a);
      const end = lerpAngle(a, b, 1);
      expect(Math.abs(end - a)).toBeLessThanOrEqual(Math.PI + EPSILON);
      // Equivalent to b modulo a full turn.
      expect(Math.abs(Math.cos(end) - Math.cos(b))).toBeLessThan(EPSILON);
      expect(Math.abs(Math.sin(end) - Math.sin(b))).toBeLessThan(EPSILON);
      // The midpoint is halfway along that same arc.
      expect(Math.abs(lerpAngle(a, b, 0.5) - a)).toBeLessThanOrEqual(Math.PI / 2 + EPSILON);
    }
  });

  it('lerpAngle goes counter-clockwise between exactly opposite angles', () => {
    expect(lerpAngle(0, Math.PI, 0.5)).toBe(Math.PI / 2);
    expect(lerpAngle(0, -Math.PI, 0.5)).toBe(Math.PI / 2);
    expect(lerpAngle(Math.PI, 0, 0.5)).toBe(1.5 * Math.PI);
    expect(lerpAngle(0, 3 * Math.PI, 1)).toBe(Math.PI);
  });
});

describe('immutability', () => {
  it('the identity constant is frozen', () => {
    expect(Object.isFrozen(IDENTITY)).toBe(true);
  });

  it('no function mutates its arguments', () => {
    // Module code is strict, so writing to a frozen argument would throw.
    const p = Object.freeze({ x: 3, y: -4 });
    const q = Object.freeze({ x: -1, y: 2 });
    const t = Object.freeze(transformFromTrs(p, 0.5, q));
    const u = Object.freeze(transformFromTrs(q, -1.25, p));
    compose(t, u);
    invert(t);
    apply(t, p);
    lerpVec2(p, q, 0.5);
    expect(p).toEqual({ x: 3, y: -4 });
    expect(q).toEqual({ x: -1, y: 2 });
    expect(t).toEqual(transformFromTrs({ x: 3, y: -4 }, 0.5, { x: -1, y: 2 }));
    expect(u).toEqual(transformFromTrs({ x: -1, y: 2 }, -1.25, { x: 3, y: -4 }));
  });
});

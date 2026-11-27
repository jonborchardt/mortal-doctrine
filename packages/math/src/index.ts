// Float math for the animation layer. Never feed these results into simulation state:
// `Math.sin`/`Math.cos` are not bit-identical across JS engines.
//
// Conventions (docs/content-conventions.md): +x right, +y up, angles in radians at runtime,
// positive = counter-clockwise.

/** A point or offset. Plain data; never mutated. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * 2D affine transform. Maps a point as
 * `x' = a*x + c*y + tx`, `y' = b*x + d*y + ty`. Plain data; never mutated.
 */
export interface Transform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Transform = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/**
 * Builds the transform that scales, then rotates (radians, counter-clockwise positive in y-up
 * space), then translates.
 */
export function transformFromTrs(translation: Vec2, rotation: number, scale: Vec2): Transform {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    a: cos * scale.x,
    b: sin * scale.x,
    c: -sin * scale.y,
    d: cos * scale.y,
    tx: translation.x,
    ty: translation.y,
  };
}

/** Child first, then parent: `apply(compose(parent, child), p) = apply(parent, apply(child, p))`. */
export function compose(parent: Transform, child: Transform): Transform {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
    ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
  };
}

/**
 * The inverse transform, or `null` when there is none: the determinant is zero (a zero scale on
 * either axis) or so small that its reciprocal is not finite. Never throws for finite input and
 * never returns `NaN` or `Infinity` components.
 */
export function invert(t: Transform): Transform | null {
  const inv = 1 / (t.a * t.d - t.b * t.c);
  if (!Number.isFinite(inv)) return null;
  const a = t.d * inv;
  const b = -t.b * inv;
  const c = -t.c * inv;
  const d = t.a * inv;
  return { a, b, c, d, tx: -(a * t.tx + c * t.ty), ty: -(b * t.tx + d * t.ty) };
}

/** Transforms a point (translation included). */
export function apply(t: Transform, p: Vec2): Vec2 {
  return { x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty };
}

const RAD_PER_DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

/** Authored degrees to runtime radians. Exact for 0 and 180. */
export function degToRad(degrees: number): number {
  return degrees * RAD_PER_DEG;
}

/** Runtime radians to degrees. Exact for 0 and pi. */
export function radToDeg(radians: number): number {
  return radians / RAD_PER_DEG;
}

/**
 * Linear interpolation, `a * (1 - t) + b * t`: exactly `a` at t = 0 and exactly `b` at t = 1 for
 * finite inputs (the `a + (b - a) * t` form does not guarantee the latter). `t` is not clamped.
 */
export function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** Component-wise {@link lerp}. */
export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/**
 * Interpolates from angle `a` toward angle `b` (radians) along the shorter arc, so the path
 * never sweeps more than half a turn whatever range the inputs are in. Exactly `a` at t = 0; at
 * t = 1 an angle equivalent to `b` modulo a full turn, not necessarily `b` itself. The result is
 * not normalised. When the two angles are exactly opposite (wrapped difference of exactly pi)
 * the path is counter-clockwise.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TAU; // (-TAU, TAU)
  if (delta > Math.PI) delta -= TAU;
  else if (delta <= -Math.PI) delta += TAU;
  return a + delta * t; // delta in (-pi, pi]
}

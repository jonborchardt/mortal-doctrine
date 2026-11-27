import { lerp, lerpVec2, type Vec2 } from '@mortal-doctrine/math';
import type { BonePose, Pose } from '@mortal-doctrine/rig';
import type { Clip, Key } from './clip';

/** A rig {@link Pose} plus an optional draw order (slot ids, back to front; see `orderSlots`). */
export interface AnimatedPose extends Pose {
  readonly drawOrder?: readonly string[];
}

/** The last key with `frame <= time`: a key takes effect on its own frame. */
function activeKey<K extends { readonly frame: number }>(
  keys: readonly K[],
  time: number,
): K | undefined {
  return keys.findLast((k) => k.frame <= time);
}

const BEZIER_ITERATIONS = 40;

/** y of the cubic easing curve at x = `u`. Fixed-count bisection, so results never vary by run. */
function ease([x1, y1, x2, y2]: readonly [number, number, number, number], u: number): number {
  const at = (p1: number, p2: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  let low = 0;
  let high = 1;
  for (let i = 0; i < BEZIER_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    if (at(x1, x2, mid) < u) low = mid;
    else high = mid;
  }
  return at(y1, y2, (low + high) / 2);
}

function channel<T>(
  keys: readonly Key<T>[] | undefined,
  time: number,
  mix: (a: T, b: T, t: number) => T,
): T | undefined {
  if (!keys) return undefined;
  const index = keys.findLastIndex((k) => k.frame <= time);
  const from = keys[index];
  const to = keys[index + 1];
  // Outside the key range a channel holds its first or last key. On a key the value is exact.
  if (!from || !to) return (from ?? to)?.value;
  if (from.frame === time || from.interpolation === 'step') return from.value;
  const u = (time - from.frame) / (to.frame - from.frame);
  return mix(
    from.value,
    to.value,
    from.interpolation === 'linear' ? u : ease(from.interpolation.bezier, u),
  );
}

/**
 * The pose of `clip` at `time`, in frames at 60 Hz (integer frame plus fractional alpha). A
 * looping clip wraps `time` modulo its duration; any other clip clamps it to `[0, duration]`.
 * Pure. Throws when `time` is not finite.
 */
export function sample(clip: Clip, time: number): AnimatedPose {
  if (!Number.isFinite(time)) throw new Error(`Cannot sample clip "${clip.id}" at time ${time}`);
  const { duration } = clip;
  const t = clip.loop
    ? ((time % duration) + duration) % duration
    : Math.min(Math.max(time, 0), duration);

  const bones: Record<string, Partial<BonePose>> = {};
  for (const [id, channels] of Object.entries(clip.bones)) {
    const rotation = channel(channels.rotation, t, lerp);
    const translation = channel<Vec2>(channels.translation, t, lerpVec2);
    const scale = channel<Vec2>(channels.scale, t, lerpVec2);
    bones[id] = {
      ...(rotation !== undefined && { rotation }),
      ...(translation && { translation }),
      ...(scale && { scale }),
    };
  }
  const attachments: Record<string, string | null> = {};
  for (const [slot, keys] of Object.entries(clip.attachments)) {
    const active = activeKey(keys, t);
    if (active) attachments[slot] = active.attachment;
  }
  const drawOrder = activeKey(clip.drawOrder, t)?.slots;
  return { bones, attachments, ...(drawOrder && { drawOrder }) };
}

/**
 * Reorders slots (for example `evaluate(rig, pose).slots`) by a pose's draw order: the listed
 * slots in the listed order, in front of any slot the order does not list (those keep their
 * relative order). Returns the input order when `drawOrder` is absent. Throws on an unknown id.
 */
export function orderSlots<T extends { readonly id: string }>(
  slots: readonly T[],
  drawOrder: readonly string[] | undefined,
): readonly T[] {
  if (!drawOrder) return slots;
  const listed = drawOrder.map((id) => {
    const slot = slots.find((candidate) => candidate.id === id);
    if (!slot) throw new Error(`Draw order names unknown slot "${id}"`);
    return slot;
  });
  return [...slots.filter((slot) => !drawOrder.includes(slot.id)), ...listed];
}

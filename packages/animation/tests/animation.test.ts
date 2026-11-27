import { degToRad, radToDeg, type Vec2 } from '@mortal-doctrine/math';
import { evaluate, loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG, NON_HUMANOID_RIG } from '@mortal-doctrine/rig/testing';
import { describe, expect, it } from 'vitest';
import {
  blend,
  blendStage,
  clipDataSchema,
  defineClip,
  key,
  loadClip,
  orderSlots,
  runPipeline,
  sample,
  type AnimatedPose,
  type Interpolation,
  type PoseStage,
} from '../src/index';
import { INVALID_CLIPS, RAISE_STAFF, SMOOTH, WALK_CYCLE, WING_FLAP } from '../src/testing';

const EPSILON = 1e-9;

function near(actual: number | undefined, expected: number, label: string) {
  expect(Math.abs((actual ?? NaN) - expected), `${label}: ${actual} vs ${expected}`).toBeLessThan(
    EPSILON,
  );
}

/** Checks a bone's sampled channels: rotation in degrees, translation and scale as `[x, y]`. */
function expectBone(
  pose: AnimatedPose,
  bone: string,
  expected: {
    readonly rotation?: number;
    readonly translation?: readonly [number, number];
    readonly scale?: readonly [number, number];
  },
) {
  const actual = pose.bones?.[bone];
  if (expected.rotation !== undefined) {
    near(radToDeg(actual?.rotation ?? NaN), expected.rotation, `${bone}.rotation`);
  }
  for (const name of ['translation', 'scale'] as const) {
    const pair = expected[name];
    if (pair) {
      near(actual?.[name]?.x, pair[0], `${bone}.${name}.x`);
      near(actual?.[name]?.y, pair[1], `${bone}.${name}.y`);
    }
  }
}

const vec = (x: number, y: number): Vec2 => ({ x, y });

/** One bone with all three channels keyed at frames 0 and 8 (rotation also at 16). */
const modeClip = (interpolation: Interpolation) =>
  loadClip(
    defineClip('golden', 16, {
      bones: {
        base: {
          // 90 to 450 is a full extra turn: rotation interpolates numerically inside a clip.
          rotation: [key(0, 0, interpolation), key(8, 90, interpolation), key(16, 450)],
          translation: [key(0, vec(0, 0), interpolation), key(8, vec(8, -4))],
          scale: [key(0, vec(1, 1), interpolation), key(8, vec(2, 0.5))],
        },
      },
    }),
  );

const mannequin = loadRig(MANNEQUIN_RIG);
const walk = loadClip(WALK_CYCLE);
const raise = loadClip(RAISE_STAFF);

describe('loadClip', () => {
  it.each(INVALID_CLIPS)('rejects $name', ({ data, message }) => {
    expect(() => loadClip(data)).toThrow(message);
  });

  it.each([WALK_CYCLE, RAISE_STAFF, WING_FLAP])('round-trips $id through the schema', (data) => {
    const parsed = clipDataSchema.parse(data);
    expect(clipDataSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(loadClip(parsed)).toEqual(loadClip(data));
  });

  it('accepts helper-built clips, converts degrees to radians and defaults to linear', () => {
    const clip = loadClip(
      defineClip('built', 10, {
        loop: true,
        bones: { base: { rotation: [{ frame: 0, value: 180 }, key(10, 90, 'step')] } },
      }),
    );
    expect(clip).toEqual({
      id: 'built',
      duration: 10,
      loop: true,
      bones: {
        base: {
          rotation: [
            { frame: 0, value: Math.PI, interpolation: 'linear' },
            { frame: 10, value: degToRad(90), interpolation: 'step' },
          ],
        },
      },
      attachments: {},
      drawOrder: [],
    });
  });
});

describe('sample: golden values per interpolation mode', () => {
  it.each(['step', 'linear', SMOOTH] as const)('%j returns exact key values', (mode) => {
    const clip = modeClip(mode);
    expect(sample(clip, 0).bones?.base).toEqual({
      rotation: 0,
      translation: vec(0, 0),
      scale: vec(1, 1),
    });
    expect(sample(clip, 8).bones?.base).toEqual({
      rotation: degToRad(90),
      translation: vec(8, -4),
      scale: vec(2, 0.5),
    });
    expect(sample(clip, 16).bones?.base?.rotation).toBe(degToRad(450));
  });

  it('step holds the earlier key until the next key frame', () => {
    const clip = modeClip('step');
    for (const time of [2, 4.5, 7.999]) {
      expectBone(sample(clip, time), 'base', { rotation: 0, translation: [0, 0], scale: [1, 1] });
    }
    expectBone(sample(clip, 12), 'base', { rotation: 90, translation: [8, -4], scale: [2, 0.5] });
  });

  it('linear moves in proportion to time', () => {
    const clip = modeClip('linear');
    expectBone(sample(clip, 2), 'base', {
      rotation: 22.5,
      translation: [2, -1],
      scale: [1.25, 0.875],
    });
    expectBone(sample(clip, 4.5), 'base', {
      rotation: 50.625,
      translation: [4.5, -2.25],
      scale: [1.5625, 0.71875],
    });
    expectBone(sample(clip, 12), 'base', { rotation: 270 });
  });

  it('bezier follows the easing curve', () => {
    // SMOOTH eases by 3u² - 2u³: 0.15625 at u = 0.25, 0.59326171875 at u = 0.5625.
    const clip = modeClip(SMOOTH);
    expectBone(sample(clip, 2), 'base', {
      rotation: 14.0625,
      translation: [1.25, -0.625],
      scale: [1.15625, 0.921875],
    });
    expectBone(sample(clip, 4.5), 'base', {
      rotation: 53.3935546875,
      translation: [4.74609375, -2.373046875],
      scale: [1.59326171875, 0.703369140625],
    });
    expectBone(sample(clip, 12), 'base', { rotation: 270 });

    // The CSS `ease` curve, whose x is not linear in the curve parameter.
    const cssEase = loadClip(
      defineClip('css-ease', 10, {
        bones: { base: { rotation: [key(0, 0, { bezier: [0.25, 0.1, 0.25, 1] }), key(10, 100)] } },
      }),
    );
    expectBone(sample(cssEase, 5), 'base', { rotation: 80.2403387585 });
    expectBone(sample(cssEase, 2.5), 'base', { rotation: 40.8510591355 });
  });
});

describe('sample: boundaries', () => {
  it('clamps a non-looping clip to [0, duration]', () => {
    expect(sample(raise, -5)).toEqual(sample(raise, 0));
    expect(sample(raise, 25)).toEqual(sample(raise, 20));
    expectBone(sample(raise, 0), 'upper-arm-right', { rotation: -90 });
    expectBone(sample(raise, 20), 'head', { scale: [1.2, 1.2] });
  });

  it('wraps a looping clip modulo its duration', () => {
    expect(sample(walk, 32)).toEqual(sample(walk, 0));
    expect(sample(walk, 32 + 5)).toEqual(sample(walk, 5));
    expect(sample(walk, 64 + 8.5)).toEqual(sample(walk, 8.5));
    expect(sample(walk, -27)).toEqual(sample(walk, 5));
    expectBone(sample(walk, 32), 'thigh-left', { rotation: 205 });
    // Just before the end it is still approaching the last key, not the first.
    expectBone(sample(walk, 31), 'shin-right', { rotation: -3.75 });
  });

  it('holds the first key before it and the last key after it', () => {
    const clip = loadClip(
      defineClip('late', 12, { bones: { base: { rotation: [key(4, 10), key(8, 50)] } } }),
    );
    for (const [time, degrees] of [
      [0, 10],
      [2, 10],
      [4, 10],
      [6, 30],
      [8, 50],
      [10, 50],
      [12, 50],
    ] as const) {
      expectBone(sample(clip, time), 'base', { rotation: degrees });
    }
  });

  it('throws on a non-finite time', () => {
    for (const time of [NaN, Infinity, -Infinity]) {
      expect(() => sample(walk, time)).toThrow('Cannot sample clip "walk-cycle" at time');
    }
  });
});

describe('sample: attachment and draw-order keys', () => {
  const slotIds = (pose: AnimatedPose) =>
    orderSlots(evaluate(mannequin, pose).slots, pose.drawOrder).map((slot) => slot.id);
  const held = (pose: AnimatedPose) =>
    evaluate(mannequin, pose).slots.find((slot) => slot.id === 'held-right')?.attachment;

  it.each([9, 9.999])('are not in effect at %d, before their frame', (time) => {
    const pose = sample(raise, time);
    expect(pose.attachments).toEqual({});
    expect(pose.drawOrder).toBeUndefined();
    expect(held(pose)).toBeNull();
    expect(slotIds(pose)).toEqual(['body', 'face', 'held-right']);
    expectBone(pose, 'forearm-right', { rotation: 0 });
  });

  it.each([10, 11])('are in effect at %d, from their frame on', (time) => {
    const pose = sample(raise, time);
    expect(pose.attachments).toEqual({ 'held-right': 'staff', face: 'face-angry' });
    expect(held(pose)).toBe('staff');
    expect(slotIds(pose)).toEqual(['held-right', 'body', 'face']);
    expectBone(pose, 'forearm-right', { rotation: 45 });
  });

  it('switch back and forth in a looping clip', () => {
    const rig = loadRig(NON_HUMANOID_RIG);
    const flap = loadClip(WING_FLAP);
    const wing = (time: number) =>
      evaluate(rig, sample(flap, time)).slots.find((slot) => slot.id === 'wing-left')?.attachment;
    expect([0, 9.5, 10, 19, 20, 30].map(wing)).toEqual([
      'wing-left-feathers',
      'wing-left-feathers',
      'wing-left-membrane',
      'wing-left-membrane',
      'wing-left-feathers',
      'wing-left-membrane',
    ]);
  });

  it('orderSlots puts listed slots in front of unlisted ones and rejects unknown ids', () => {
    const slots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderSlots(slots, undefined)).toBe(slots);
    expect(orderSlots(slots, ['c', 'a']).map((slot) => slot.id)).toEqual(['b', 'c', 'a']);
    expect(() => orderSlots(slots, ['ghost'])).toThrow('Draw order names unknown slot "ghost"');
  });
});

describe('blend', () => {
  // Walk at frame 4 (u = 0.25, eased 0.15625): hips y 88.5, thigh-left 197.1875,
  // upper-arm-right -193.75, forearm-right 15. Raised staff at its end: upper-arm-right 0,
  // forearm-right 45, head scale 1.2.
  const a = sample(walk, 4);
  const b = sample(raise, 20);

  it('at weight 0 equals pose A', () => {
    const result = blend(mannequin, a, b, 0);
    for (const [id, bone] of Object.entries(a.bones ?? {})) {
      expect(result.bones?.[id], id).toEqual(bone);
    }
    expect(result.attachments).toEqual(a.attachments);
    expect(result.drawOrder).toBeUndefined();
    expect(evaluate(mannequin, result)).toEqual(evaluate(mannequin, a));
  });

  it('at weight 1 equals pose B', () => {
    const result = blend(mannequin, a, b, 1);
    expect(result.bones?.head?.scale).toEqual(vec(1.2, 1.2));
    // A names the hips translation and B does not, so at B it is back at rest.
    expect(result.bones?.hips?.translation).toEqual(vec(0, 90));
    expect(result.attachments).toEqual(b.attachments);
    expect(result.drawOrder).toEqual(b.drawOrder);
    const expected = evaluate(mannequin, b);
    evaluate(mannequin, result).bones.forEach(({ id, transform }, index) => {
      const want = expected.bones[index]?.transform;
      for (const field of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
        near(transform[field], want?.[field] ?? NaN, `${id}.${field}`);
      }
    });
  });

  it('at intermediate weights matches pinned values', () => {
    const quarter = blend(mannequin, a, b, 0.25);
    // -193.75 to 0 is 166.25 degrees the short way round, which is clockwise.
    expectBone(quarter, 'upper-arm-right', { rotation: -235.3125 });
    expectBone(quarter, 'forearm-right', { rotation: 22.5 });
    expectBone(quarter, 'hips', { translation: [0, 88.875] });
    expectBone(quarter, 'head', { scale: [1.05, 1.05] });

    const half = blend(mannequin, a, b, 0.5);
    expectBone(half, 'upper-arm-right', { rotation: -276.875 });
    expectBone(half, 'forearm-right', { rotation: 30 });
    expectBone(half, 'hips', { translation: [0, 89.25] });
    expectBone(half, 'head', { scale: [1.1, 1.1] });
  });

  it('blends a bone only one pose names against the rig rest value', () => {
    // thigh-left rests at 180 and only the walk names it.
    expectBone(blend(mannequin, a, b, 0.5), 'thigh-left', { rotation: 188.59375 });
    expectBone(blend(mannequin, b, a, 0.5), 'thigh-left', { rotation: 188.59375 });
    // A channel neither pose names stays absent.
    expect(blend(mannequin, a, b, 0.5).bones?.['thigh-left']).not.toHaveProperty('scale');
  });

  it('takes attachments and draw order from A below weight 0.5, otherwise from B', () => {
    const before = blend(mannequin, a, b, 0.49);
    expect(before.attachments).toEqual({});
    expect(before.drawOrder).toBeUndefined();
    const from = blend(mannequin, a, b, 0.5);
    expect(from.attachments).toEqual({ 'held-right': 'staff', face: 'face-angry' });
    expect(from.drawOrder).toEqual(['held-right', 'body', 'face']);
  });

  it('throws for a weight outside [0, 1] and for a bone the rig does not have', () => {
    for (const weight of [-0.1, 1.1, NaN]) {
      expect(() => blend(mannequin, a, b, weight)).toThrow('Blend weight must be in [0, 1]');
    }
    expect(() => blend(mannequin, a, { bones: { ghost: { rotation: 0 } } }, 0.5)).toThrow(
      'Pose names unknown bone "ghost" of rig "mannequin"',
    );
  });
});

describe('determinism', () => {
  it('gives equal results for equal inputs and does not mutate them', () => {
    const rig = loadRig(MANNEQUIN_RIG);
    const clip = loadClip(WALK_CYCLE);
    const other = sample(loadClip(RAISE_STAFF), 12);
    const before: unknown = JSON.parse(JSON.stringify({ rig, clip, other }));

    const first = sample(clip, 5.25);
    expect(sample(clip, 5.25)).toEqual(first);
    expect(sample(loadClip(WALK_CYCLE), 5.25)).toEqual(first);
    const blended = blend(rig, first, other, 0.3);
    expect(blend(rig, first, other, 0.3)).toEqual(blended);
    expect(first).toEqual(sample(clip, 5.25));

    expect({ rig, clip, other }).toEqual(before);
  });
});

describe('pose pipeline', () => {
  const pose = sample(walk, 4);
  const face =
    (attachment: string | null): PoseStage =>
    (_rig, current) => ({ ...current, attachments: { ...current.attachments, face: attachment } });

  it('returns the input pose for an empty list', () => {
    expect(runPipeline(mannequin, pose, [])).toBe(pose);
  });

  it('runs stages in list order', () => {
    const angry = face('face-angry');
    const none = face(null);
    expect(runPipeline(mannequin, pose, [angry, none]).attachments).toEqual({ face: null });
    expect(runPipeline(mannequin, pose, [none, angry]).attachments).toEqual({
      face: 'face-angry',
    });
  });

  it('the blend stage gives the same result as blend', () => {
    const other = sample(raise, 20);
    expect(runPipeline(mannequin, pose, [blendStage(other, 0.25)])).toEqual(
      blend(mannequin, pose, other, 0.25),
    );
  });
});

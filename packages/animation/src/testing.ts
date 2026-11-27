// Clip and constraint fixtures for tests and the Studio labs, for the rig fixtures in
// `@mortal-doctrine/rig/testing`. Angles are local bone rotations in degrees.
import type { RigData } from '@mortal-doctrine/rig';
import { defineClip, key, type ClipData } from './clip';
import type { ConstraintsData } from './constraint';

/** Ease in and out. Its x is linear in the curve parameter, so y(u) = 3u² - 2u³ exactly. */
export const SMOOTH = { bezier: [1 / 3, 0, 2 / 3, 1] } as const;

const swing = (from: number, to: number, duration: number) => [
  key(0, from, SMOOTH),
  key(duration / 2, to, SMOOTH),
  key(duration, from),
];

/**
 * Looping 32-frame walk for `MANNEQUIN_RIG`: arms lowered from the T-pose and swinging, thighs
 * swinging in opposition, each shin bending while its leg comes forward, hips bobbing.
 *
 * `thigh-left` rotation: 205 at frame 0, 180 at frame 8 (smooth), 155 at frame 16, 205 at 32.
 */
export const WALK_CYCLE: ClipData = defineClip('walk-cycle', 32, {
  loop: true,
  bones: {
    hips: {
      translation: [
        key(0, { x: 0, y: 90 }),
        key(8, { x: 0, y: 87 }),
        key(16, { x: 0, y: 90 }),
        key(24, { x: 0, y: 87 }),
        key(32, { x: 0, y: 90 }),
      ],
    },
    'thigh-left': { rotation: swing(205, 155, 32) },
    'thigh-right': { rotation: swing(155, 205, 32) },
    'shin-left': { rotation: [key(0, 0), key(8, 30), key(16, 0)] },
    'shin-right': { rotation: [key(16, 0), key(24, -30), key(32, 0)] },
    'upper-arm-left': { rotation: swing(160, 200, 32) },
    'upper-arm-right': { rotation: swing(-200, -160, 32) },
    'forearm-left': { rotation: [key(0, -15)] },
    'forearm-right': { rotation: [key(0, 15)] },
  },
});

/**
 * Non-looping 20-frame clip for `MANNEQUIN_RIG`: the right arm rises, and at frame 10 the
 * forearm snaps up (`step`), the staff appears, the face turns angry and the staff's slot moves
 * behind the body. The head grows over the whole clip.
 */
export const RAISE_STAFF: ClipData = defineClip('raise-staff', 20, {
  bones: {
    'upper-arm-right': { rotation: [key(0, -90), key(10, 0)] },
    'forearm-right': { rotation: [key(0, 0, 'step'), key(10, 45)] },
    head: { scale: [key(0, { x: 1, y: 1 }), key(20, { x: 1.2, y: 1.2 })] },
  },
  attachments: {
    'held-right': [{ frame: 10, attachment: 'staff' }],
    face: [{ frame: 10, attachment: 'face-angry' }],
  },
  drawOrder: [{ frame: 10, slots: ['held-right', 'body', 'face'] }],
});

/** Looping 20-frame flap for `NON_HUMANOID_RIG`; the wings turn to membrane on the upstroke. */
export const WING_FLAP: ClipData = defineClip('wing-flap', 20, {
  loop: true,
  bones: {
    'wing-left-1': { rotation: swing(45, 90, 20) },
    'wing-right-1': { rotation: swing(-45, -90, 20) },
  },
  attachments: {
    'wing-left': [
      { frame: 0, attachment: 'wing-left-feathers' },
      { frame: 10, attachment: 'wing-left-membrane' },
    ],
    'wing-right': [
      { frame: 0, attachment: 'wing-right-feathers' },
      { frame: 10, attachment: 'wing-right-membrane' },
    ],
  },
});

const SMALL = defineClip('small', 10, {
  bones: { base: { rotation: [key(0, 0), key(10, 90)] } },
});
const rotationKeys = (...keys: readonly unknown[]) => ({
  ...SMALL,
  bones: { base: { rotation: keys } },
});

/**
 * Clips `loadClip` must reject: a small valid clip with one defect each. `message` is a fragment
 * of the expected error naming the problem.
 */
export const INVALID_CLIPS: readonly {
  readonly name: string;
  readonly data: unknown;
  readonly message: string;
}[] = [
  {
    name: 'an unknown schemaVersion',
    data: { ...SMALL, schemaVersion: 2 },
    message: 'Unsupported clip schemaVersion 2; supported: 1',
  },
  {
    name: 'a non-integer key frame',
    data: rotationKeys(key(0, 0), key(2.5, 90)),
    message: 'clip.bones.base.rotation.1.frame',
  },
  {
    name: 'a negative key frame',
    data: rotationKeys(key(-1, 0), key(10, 90)),
    message: 'clip.bones.base.rotation.0.frame',
  },
  {
    name: 'a key frame beyond the duration',
    data: rotationKeys(key(0, 0), key(11, 90)),
    message: 'bone "base" rotation key frame 11 is beyond duration 10',
  },
  {
    name: 'unsorted key frames',
    data: rotationKeys(key(5, 0), key(2, 90)),
    message: 'bone "base" rotation key frames must be strictly ascending (2 follows 5)',
  },
  {
    name: 'duplicate key frames',
    data: rotationKeys(key(5, 0), key(5, 90)),
    message: 'bone "base" rotation key frames must be strictly ascending (5 follows 5)',
  },
  {
    name: 'an attachment key beyond the duration',
    data: { ...SMALL, attachments: { skin: [{ frame: 11, attachment: null }] } },
    message: 'slot "skin" attachment key frame 11 is beyond duration 10',
  },
  {
    name: 'unsorted draw-order keys',
    data: {
      ...SMALL,
      drawOrder: [
        { frame: 4, slots: ['skin'] },
        { frame: 3, slots: ['skin'] },
      ],
    },
    message: 'draw-order key frames must be strictly ascending (3 follows 4)',
  },
  {
    name: 'a draw-order key listing a slot twice',
    data: { ...SMALL, drawOrder: [{ frame: 0, slots: ['skin', 'skin'] }] },
    message: 'draw-order key at frame 0 lists a slot twice',
  },
  {
    name: 'a zero duration',
    data: { ...SMALL, duration: 0 },
    message: 'clip.duration',
  },
  {
    name: 'a negative duration',
    data: { ...SMALL, duration: -10 },
    message: 'clip.duration',
  },
  {
    name: 'an id that is not kebab-case',
    data: { ...SMALL, id: 'Walk_Cycle' },
    message: 'id "Walk_Cycle" must be kebab-case',
  },
  {
    name: 'a bezier x control outside [0, 1]',
    data: rotationKeys({ frame: 0, value: 0, interpolation: { bezier: [1.5, 0, 0.5, 1] } }),
    message: 'clip.bones.base.rotation.0.interpolation.bezier.0: Too big',
  },
  {
    name: 'an unknown interpolation mode',
    data: rotationKeys({ frame: 0, value: 0, interpolation: 'cubic' }),
    message: 'clip.bones.base.rotation.0.interpolation: interpolation must be "step", "linear" or',
  },
];

/**
 * For `MANNEQUIN_RIG`: the right arm (shoulder at (10, 146), segments 30 and 28) reaches for a
 * point in front of the body, the head aims at the same point, and limits keep the elbow from
 * folding flat and the head from turning more than 40 degrees. The head limit is in effect at
 * this target; the elbow limit is not, so the hand reaches it.
 */
export const MANNEQUIN_REACH: ConstraintsData = {
  schemaVersion: 1,
  id: 'mannequin-reach',
  constraints: [
    {
      type: 'two-bone-ik',
      parent: 'upper-arm-right',
      child: 'forearm-right',
      target: { x: 50, y: 120 },
      bend: 1,
      mix: 1,
    },
    { type: 'aim', bone: 'head', target: { x: 50, y: 120 }, mix: 1 },
    { type: 'limit', bone: 'forearm-right', min: -150, max: 150 },
    { type: 'limit', bone: 'head', min: -40, max: 40 },
  ],
};

/**
 * A two-bone chain whose joint is off the parent's +x axis: `lower` sits at (12, 9) in `upper`,
 * so the first segment is 15 long while `upper.length` is 20. The second segment is 10. The
 * chain root is at world (5, 10), under a `base` bone turned 30 degrees.
 */
export const OFFSET_CHAIN_RIG: RigData = {
  schemaVersion: 1,
  id: 'offset-chain',
  bones: [
    {
      id: 'base',
      translation: { x: 5, y: 10 },
      rotation: 30,
      scale: { x: 1, y: 1 },
      length: 0,
    },
    {
      id: 'upper',
      parent: 'base',
      translation: { x: 0, y: 0 },
      rotation: 20,
      scale: { x: 1, y: 1 },
      length: 20,
    },
    {
      id: 'lower',
      parent: 'upper',
      translation: { x: 12, y: 9 },
      rotation: -45,
      scale: { x: 1, y: 1 },
      length: 10,
    },
  ],
  slots: [],
  attachments: [],
  anchors: [],
};

const withConstraint = (constraint: unknown) => ({
  schemaVersion: 1,
  id: 'small',
  constraints: [constraint],
});
const TARGET = { x: 0, y: 0 };

/**
 * Constraint data `loadConstraints` must reject: one defect each. `message` is a fragment of the
 * expected error naming the problem.
 */
export const INVALID_CONSTRAINTS: readonly {
  readonly name: string;
  readonly data: unknown;
  readonly message: string;
}[] = [
  {
    name: 'an unknown schemaVersion',
    data: { ...MANNEQUIN_REACH, schemaVersion: 2 },
    message: 'Unsupported constraints schemaVersion 2; supported: 1',
  },
  {
    name: 'a mix above 1',
    data: withConstraint({ type: 'aim', bone: 'tip', target: TARGET, mix: 1.5 }),
    message: 'constraints.constraints.0.mix: Too big',
  },
  {
    name: 'a negative mix',
    data: withConstraint({
      type: 'two-bone-ik',
      parent: 'base',
      child: 'tip',
      target: TARGET,
      bend: 1,
      mix: -0.1,
    }),
    message: 'constraints.constraints.0.mix: Too small',
  },
  {
    name: 'a limit with min above max',
    data: withConstraint({ type: 'limit', bone: 'tip', min: 10, max: -10 }),
    message: 'limit on "tip" has min 10 above max -10',
  },
  {
    name: 'a limit spanning a full turn',
    data: withConstraint({ type: 'limit', bone: 'tip', min: -180, max: 180 }),
    message: 'limit on "tip" spans a full turn or more',
  },
  {
    name: 'two limits on one bone',
    data: {
      schemaVersion: 1,
      id: 'small',
      constraints: [
        { type: 'limit', bone: 'tip', min: 0, max: 10 },
        { type: 'limit', bone: 'tip', min: 20, max: 30 },
      ],
    },
    message: 'bone "tip" has more than one limit',
  },
  {
    name: 'a bend that is not 1 or -1',
    data: withConstraint({
      type: 'two-bone-ik',
      parent: 'base',
      child: 'tip',
      target: TARGET,
      bend: 0,
      mix: 1,
    }),
    message: 'constraints.constraints.0.bend: bend must be 1 or -1',
  },
  {
    name: 'a bone id that is not kebab-case',
    data: withConstraint({ type: 'aim', bone: 'Upper_Arm', target: TARGET, mix: 1 }),
    message: 'id "Upper_Arm" must be kebab-case',
  },
  {
    name: 'an id that is not kebab-case',
    data: { ...MANNEQUIN_REACH, id: 'Mannequin Reach' },
    message: 'id "Mannequin Reach" must be kebab-case',
  },
  {
    name: 'an unknown constraint type',
    data: withConstraint({ type: 'spring', bone: 'tip' }),
    message: 'constraints.constraints.0.type',
  },
];

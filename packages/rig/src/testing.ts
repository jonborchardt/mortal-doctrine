// Rig fixtures for tests and the Skeleton Lab. Front views, y-up, in world units; every angle
// is a multiple of 45 degrees so world positions can be computed by hand.
import type { RigData, RigExtensionData } from './rig';

type BoneData = RigData['bones'][number];

function bone(
  id: string,
  parent: string | undefined,
  x: number,
  y: number,
  rotation: number,
  length: number,
): BoneData {
  return { id, parent, translation: { x, y }, rotation, scale: { x: 1, y: 1 }, length };
}

/**
 * Reference mannequin in a T-pose, origin on the ground between the feet. `hips` points up, so
 * for the bones above it local +x is world up and local +y is world left.
 *
 * Rest world positions: crown (0, 175); shoulders (-10, 146) and (10, 146); hands start at
 * (-68, 146) and (68, 146); `grip-right` (73, 146); feet (-8, 0) and (8, 0).
 */
export const MANNEQUIN_RIG: RigData = {
  schemaVersion: 1,
  id: 'mannequin',
  bones: [
    bone('root', undefined, 0, 0, 0, 0),
    bone('hips', 'root', 0, 90, 90, 20),
    bone('spine', 'hips', 20, 0, 0, 40),
    bone('head', 'spine', 40, 0, 0, 25),
    bone('upper-arm-left', 'spine', 36, 10, 90, 30),
    bone('forearm-left', 'upper-arm-left', 30, 0, 0, 28),
    bone('hand-left', 'forearm-left', 28, 0, 0, 10),
    bone('upper-arm-right', 'spine', 36, -10, -90, 30),
    bone('forearm-right', 'upper-arm-right', 30, 0, 0, 28),
    bone('hand-right', 'forearm-right', 28, 0, 0, 10),
    bone('thigh-left', 'hips', 0, 8, 180, 45),
    bone('shin-left', 'thigh-left', 45, 0, 0, 45),
    bone('thigh-right', 'hips', 0, -8, 180, 45),
    bone('shin-right', 'thigh-right', 45, 0, 0, 45),
  ],
  slots: [
    { id: 'body', bone: 'spine', drawOrder: 0, attachment: 'body-plain' },
    { id: 'face', bone: 'head', drawOrder: 1, attachment: 'face-neutral' },
    { id: 'held-right', bone: 'hand-right', drawOrder: 2 },
  ],
  attachments: [
    { id: 'body-plain', slot: 'body' },
    { id: 'body-robe', slot: 'body' },
    { id: 'face-neutral', slot: 'face' },
    { id: 'face-angry', slot: 'face' },
    { id: 'staff', slot: 'held-right' },
  ],
  anchors: [
    { id: 'root', bone: 'root', position: { x: 0, y: 0 } },
    { id: 'crown', bone: 'head', position: { x: 25, y: 0 } },
    { id: 'grip-right', bone: 'hand-right', position: { x: 5, y: 0 } },
  ],
};

/**
 * Not a biped: one upright `core` bone (the root, floating at y = 60) carrying four one-bone
 * arms and two two-bone wings.
 *
 * Rest world positions: `palm-lower-right` (40, 85); `palm-upper-left` (-40, 105);
 * `wingtip-left` (-35 - 20√2, 100 + 20√2); `wingtip-right` (35 + 20√2, 100 + 20√2); `root`
 * (0, 0).
 */
export const NON_HUMANOID_RIG: RigData = {
  schemaVersion: 1,
  id: 'four-arms-and-wings',
  bones: [
    bone('core', undefined, 0, 60, 90, 50),
    bone('arm-upper-left', 'core', 45, 10, 90, 30),
    bone('arm-upper-right', 'core', 45, -10, -90, 30),
    bone('arm-lower-left', 'core', 25, 10, 90, 30),
    bone('arm-lower-right', 'core', 25, -10, -90, 30),
    bone('wing-left-1', 'core', 40, 5, 45, 40),
    bone('wing-left-2', 'wing-left-1', 40, 0, 45, 30),
    bone('wing-right-1', 'core', 40, -5, -45, 40),
    bone('wing-right-2', 'wing-right-1', 40, 0, -45, 30),
  ],
  slots: [
    { id: 'wing-left', bone: 'wing-left-1', drawOrder: -2, attachment: 'wing-left-feathers' },
    { id: 'wing-right', bone: 'wing-right-1', drawOrder: -1, attachment: 'wing-right-feathers' },
    { id: 'shell', bone: 'core', drawOrder: 0, attachment: 'shell-plain' },
  ],
  attachments: [
    { id: 'wing-left-feathers', slot: 'wing-left' },
    { id: 'wing-left-membrane', slot: 'wing-left' },
    { id: 'wing-right-feathers', slot: 'wing-right' },
    { id: 'wing-right-membrane', slot: 'wing-right' },
    { id: 'shell-plain', slot: 'shell' },
  ],
  anchors: [
    { id: 'root', bone: 'core', position: { x: -60, y: 0 } },
    { id: 'palm-upper-left', bone: 'arm-upper-left', position: { x: 30, y: 0 } },
    { id: 'palm-lower-right', bone: 'arm-lower-right', position: { x: 30, y: 0 } },
    { id: 'wingtip-left', bone: 'wing-left-2', position: { x: 30, y: 0 } },
    { id: 'wingtip-right', bone: 'wing-right-2', position: { x: 30, y: 0 } },
  ],
};

/**
 * A two-bone tail for the mannequin: out to the right of the hips, then up. It adds a slot
 * behind the body, attachments (one of them for the base `body` slot) and an anchor.
 *
 * Rest world positions on the mannequin: `tail-2` starts at (20, 90); `tail-tip` (20, 105).
 */
export const TAIL_EXTENSION: RigExtensionData = {
  schemaVersion: 1,
  id: 'tail',
  bones: [bone('tail-1', 'hips', 0, 0, -90, 20), bone('tail-2', 'tail-1', 20, 0, 90, 15)],
  slots: [{ id: 'tail', bone: 'tail-1', drawOrder: -1, attachment: 'tail-plain' }],
  attachments: [
    { id: 'tail-plain', slot: 'tail' },
    { id: 'tail-spiked', slot: 'tail' },
    { id: 'body-armor', slot: 'body' },
  ],
  anchors: [{ id: 'tail-tip', bone: 'tail-2', position: { x: 15, y: 0 } }],
};

const SMALL: RigData = {
  schemaVersion: 1,
  id: 'small',
  bones: [bone('base', undefined, 0, 0, 0, 10), bone('tip', 'base', 10, 0, 0, 10)],
  slots: [
    { id: 'skin', bone: 'base', drawOrder: 0, attachment: 'skin-a' },
    { id: 'prop', bone: 'tip', drawOrder: 1 },
  ],
  attachments: [
    { id: 'skin-a', slot: 'skin' },
    { id: 'prop-a', slot: 'prop' },
  ],
  anchors: [{ id: 'point', bone: 'tip', position: { x: 10, y: 0 } }],
};

/**
 * Rigs `loadRig` must reject: a small valid rig with one defect each. `message` is a fragment
 * of the expected error naming the offending id and the broken rule.
 */
export const INVALID_RIGS: readonly {
  readonly name: string;
  readonly data: unknown;
  readonly message: string;
}[] = [
  {
    name: 'a parent cycle',
    data: {
      ...SMALL,
      bones: [
        ...SMALL.bones,
        bone('loop-a', 'loop-b', 0, 0, 0, 1),
        bone('loop-b', 'loop-a', 0, 0, 0, 1),
      ],
    },
    message: 'bone "loop-a" has a cycle in its parent chain',
  },
  {
    name: 'an orphan parent',
    data: { ...SMALL, bones: [...SMALL.bones, bone('stray', 'nowhere', 0, 0, 0, 1)] },
    message: 'bone "stray" has unknown parent "nowhere"',
  },
  {
    name: 'a duplicate bone id',
    data: { ...SMALL, bones: [...SMALL.bones, bone('tip', 'base', 0, 0, 0, 1)] },
    message: 'duplicate bone id "tip"',
  },
  {
    name: 'a duplicate slot id',
    data: { ...SMALL, slots: [...SMALL.slots, { id: 'skin', bone: 'tip', drawOrder: 2 }] },
    message: 'duplicate slot id "skin"',
  },
  {
    name: 'a duplicate attachment id',
    data: { ...SMALL, attachments: [...SMALL.attachments, { id: 'skin-a', slot: 'skin' }] },
    message: 'duplicate attachment id "skin-a"',
  },
  {
    name: 'a duplicate anchor id',
    data: { ...SMALL, anchors: [...SMALL.anchors, ...SMALL.anchors] },
    message: 'duplicate anchor id "point"',
  },
  {
    name: 'zero roots',
    data: {
      ...SMALL,
      bones: [bone('base', 'tip', 0, 0, 0, 10), bone('tip', 'base', 10, 0, 0, 10)],
    },
    message: 'expected exactly one root bone (a bone with no parent), found 0',
  },
  {
    name: 'two roots',
    data: { ...SMALL, bones: [...SMALL.bones, bone('other', undefined, 0, 0, 0, 1)] },
    message: 'expected exactly one root bone (a bone with no parent), found 2: "base", "other"',
  },
  {
    name: 'a slot naming an unknown bone',
    data: { ...SMALL, slots: [{ id: 'skin', bone: 'ghost', drawOrder: 0 }] },
    message: 'slot "skin" names unknown bone "ghost"',
  },
  {
    name: 'an anchor naming an unknown bone',
    data: { ...SMALL, anchors: [{ id: 'point', bone: 'ghost', position: { x: 0, y: 0 } }] },
    message: 'anchor "point" names unknown bone "ghost"',
  },
  {
    name: 'an unknown default attachment',
    data: { ...SMALL, slots: [{ id: 'skin', bone: 'base', drawOrder: 0, attachment: 'ghost' }] },
    message: 'slot "skin" has unknown default attachment "ghost"',
  },
  {
    name: "a default attachment that is another slot's",
    data: {
      ...SMALL,
      slots: [
        { id: 'skin', bone: 'base', drawOrder: 0 },
        { id: 'prop', bone: 'tip', drawOrder: 1, attachment: 'skin-a' },
      ],
    },
    message: 'slot "prop" default attachment "skin-a" belongs to slot "skin"',
  },
  {
    name: 'an attachment naming an unknown slot',
    data: { ...SMALL, attachments: [...SMALL.attachments, { id: 'lost', slot: 'ghost' }] },
    message: 'attachment "lost" names unknown slot "ghost"',
  },
  {
    name: 'a duplicate draw order',
    data: {
      ...SMALL,
      slots: [
        { id: 'skin', bone: 'base', drawOrder: 1 },
        { id: 'prop', bone: 'tip', drawOrder: 1 },
      ],
    },
    message: 'slots "skin" and "prop" share draw order 1',
  },
  {
    name: 'an id that is not kebab-case',
    data: { ...SMALL, bones: [...SMALL.bones, bone('Upper_Limb', 'base', 0, 0, 0, 1)] },
    message: 'id "Upper_Limb" must be kebab-case',
  },
  {
    name: 'a negative bone length',
    data: { ...SMALL, bones: [...SMALL.bones, bone('short', 'base', 0, 0, 0, -1)] },
    message: 'rig.bones.2.length',
  },
  {
    name: 'an unknown schemaVersion',
    data: { ...SMALL, schemaVersion: 2 },
    message: 'Unsupported rig schemaVersion 2; supported: 1',
  },
];

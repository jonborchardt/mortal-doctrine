import type { Transform, Vec2 } from '@mortal-doctrine/math';
import { describe, expect, it } from 'vitest';
import { evaluate, extendRig, loadRig, type EvaluatedRig, type RigData } from '../src/index';
import { INVALID_RIGS, MANNEQUIN_RIG, NON_HUMANOID_RIG, TAIL_EXTENSION } from '../src/testing';

const EPSILON = 1e-9;
const SQRT2 = Math.SQRT2;

function close(actual: object | undefined, expected: Transform | Vec2, label: string) {
  expect(actual, label).toBeDefined();
  for (const [field, value] of Object.entries(expected)) {
    // A field missing from `actual` compares as NaN, which fails the tolerance check below.
    const got = (actual as Record<string, number>)[field];
    expect(
      Math.abs((got ?? NaN) - value),
      `${label}.${field}: ${got} vs ${value}`,
    ).toBeLessThanOrEqual(EPSILON);
  }
}

/** `[a, b, c, d, tx, ty]`. */
type Matrix = readonly [number, number, number, number, number, number];
const matrix = ([a, b, c, d, tx, ty]: Matrix): Transform => ({ a, b, c, d, tx, ty });

function expectBones(result: EvaluatedRig, expected: Record<string, Matrix>) {
  for (const [id, values] of Object.entries(expected)) {
    close(result.bones.find((bone) => bone.id === id)?.transform, matrix(values), `bone ${id}`);
  }
}

function expectAnchors(result: EvaluatedRig, expected: Record<string, readonly [number, number]>) {
  for (const [id, [x, y]] of Object.entries(expected)) {
    close(result.anchors.find((anchor) => anchor.id === id)?.position, { x, y }, `anchor ${id}`);
  }
}

const activeAttachments = (result: EvaluatedRig) =>
  Object.fromEntries(result.slots.map((slot) => [slot.id, slot.attachment]));

describe('loadRig', () => {
  it.each(INVALID_RIGS)('rejects $name', ({ data, message }) => {
    expect(() => loadRig(data)).toThrow(message);
  });

  it('accepts the fixtures and converts degrees to radians', () => {
    const rig = loadRig(MANNEQUIN_RIG);
    expect(rig.id).toBe('mannequin');
    expect(rig.bones.find((bone) => bone.id === 'hips')?.rest.rotation).toBe(Math.PI / 2);
    expect(loadRig(NON_HUMANOID_RIG).bones).toHaveLength(9);
  });

  it('orders bones parents first and slots by draw order, whatever the authored order', () => {
    const rig = loadRig({
      ...MANNEQUIN_RIG,
      bones: MANNEQUIN_RIG.bones.toReversed(),
      slots: MANNEQUIN_RIG.slots.toReversed(),
    });
    const position = new Map(rig.bones.map((bone, index) => [bone.id, index]));
    for (const bone of rig.bones) {
      if (bone.parent !== null) {
        expect(position.get(bone.parent)).toBeLessThan(position.get(bone.id) ?? -1);
      }
    }
    expect(rig.slots.map((slot) => slot.id)).toEqual(['body', 'face', 'held-right']);
    expectAnchors(evaluate(rig, {}), { crown: [0, 175], 'grip-right': [73, 146] });
  });
});

describe('evaluate: mannequin golden values', () => {
  const rig = loadRig(MANNEQUIN_RIG);

  it('matches hand-computed world transforms at rest (the empty pose)', () => {
    const result = evaluate(rig, {});
    expectBones(result, {
      root: [1, 0, 0, 1, 0, 0],
      hips: [0, 1, -1, 0, 0, 90], // 90 degrees: +x is up
      spine: [0, 1, -1, 0, 0, 110],
      head: [0, 1, -1, 0, 0, 150],
      'upper-arm-left': [-1, 0, 0, -1, -10, 146], // 180 degrees
      'hand-left': [-1, 0, 0, -1, -68, 146],
      'upper-arm-right': [1, 0, 0, 1, 10, 146], // 0 degrees
      'forearm-right': [1, 0, 0, 1, 40, 146],
      'hand-right': [1, 0, 0, 1, 68, 146],
      'thigh-left': [0, -1, 1, 0, -8, 90], // 270 degrees: +x is down
      'shin-left': [0, -1, 1, 0, -8, 45],
      'shin-right': [0, -1, 1, 0, 8, 45],
    });
    expect(result.bones.map((bone) => bone.id)).toEqual(rig.bones.map((bone) => bone.id));
    expect(result.slots.map((slot) => [slot.id, slot.drawOrder, slot.attachment])).toEqual([
      ['body', 0, 'body-plain'],
      ['face', 1, 'face-neutral'],
      ['held-right', 2, null],
    ]);
    close(result.slots[0]?.transform, matrix([0, 1, -1, 0, 0, 110]), 'slot body');
    close(result.slots[2]?.transform, matrix([1, 0, 0, 1, 68, 146]), 'slot held-right');
    expectAnchors(result, { root: [0, 0], crown: [0, 175], 'grip-right': [73, 146] });
  });

  it('matches hand-computed world transforms with the right forearm at 90 degrees', () => {
    const result = evaluate(rig, { bones: { 'forearm-right': { rotation: Math.PI / 2 } } });
    expectBones(result, {
      'upper-arm-right': [1, 0, 0, 1, 10, 146],
      'forearm-right': [0, 1, -1, 0, 40, 146], // same elbow, now pointing up
      'hand-right': [0, 1, -1, 0, 40, 174],
      'hand-left': [-1, 0, 0, -1, -68, 146],
    });
    close(result.slots[2]?.transform, matrix([0, 1, -1, 0, 40, 174]), 'slot held-right');
    expectAnchors(result, { root: [0, 0], crown: [0, 175], 'grip-right': [40, 179] });
  });

  it('replaces the rest value instead of adding to it', () => {
    // The right upper arm rests at -90 degrees (world 0). Posed to -30 degrees it is at world
    // 60 degrees: elbow at (10 + 30 cos 60, 146 + 30 sin 60).
    const result = evaluate(rig, { bones: { 'upper-arm-right': { rotation: -Math.PI / 6 } } });
    const cos = 0.5;
    const sin = Math.sqrt(3) / 2;
    expectBones(result, { 'forearm-right': [cos, sin, -sin, cos, 10 + 30 * cos, 146 + 30 * sin] });
    expectAnchors(result, { 'grip-right': [10 + 63 * cos, 146 + 63 * sin] });
  });

  it('leaves the channels a pose does not name at rest', () => {
    const moved = evaluate(rig, { bones: { hips: { translation: { x: 10, y: 80 } } } });
    expectBones(moved, { hips: [0, 1, -1, 0, 10, 80] }); // rotation still 90 degrees
    expectAnchors(moved, { crown: [10, 165] });

    const stretched = evaluate(rig, { bones: { head: { scale: { x: 2, y: 1 } } } });
    expectBones(stretched, { head: [0, 2, -1, 0, 0, 150] }); // translation and rotation at rest
    expectAnchors(stretched, { crown: [0, 200] });
  });

  it('is pure: the same rig and pose give the same result and the rig is untouched', () => {
    const before = JSON.stringify(rig);
    const pose = { bones: { spine: { rotation: 0.3 } }, attachments: { face: null } };
    expect(evaluate(rig, pose)).toEqual(evaluate(rig, pose));
    expect(JSON.stringify(rig)).toBe(before);
  });

  it('rejects a pose naming an unknown bone', () => {
    expect(() => evaluate(rig, { bones: { tentacle: { rotation: 1 } } })).toThrow(
      'Pose names unknown bone "tentacle" of rig "mannequin"',
    );
  });
});

describe('evaluate: four arms and wings', () => {
  const rig = loadRig(NON_HUMANOID_RIG);

  it('matches hand-computed anchor positions at rest', () => {
    const result = evaluate(rig, {});
    expectBones(result, {
      core: [0, 1, -1, 0, 0, 60],
      'arm-lower-right': [1, 0, 0, 1, 10, 85],
      'wing-left-2': [-1, 0, 0, -1, -5 - 20 * SQRT2, 100 + 20 * SQRT2],
    });
    expectAnchors(result, {
      root: [0, 0],
      'palm-upper-left': [-40, 105],
      'palm-lower-right': [40, 85],
      'wingtip-left': [-35 - 20 * SQRT2, 100 + 20 * SQRT2],
      'wingtip-right': [35 + 20 * SQRT2, 100 + 20 * SQRT2],
    });
    expect(result.slots.map((slot) => slot.id)).toEqual(['wing-left', 'wing-right', 'shell']);
  });

  it('matches hand-computed anchor positions when posed', () => {
    const result = evaluate(rig, {
      bones: {
        'arm-lower-right': { rotation: 0 }, // world 90 degrees: straight up from (10, 85)
        'wing-left-1': { rotation: Math.PI / 2 }, // world 180 degrees: tip at (-45, 100)
      },
    });
    expectAnchors(result, {
      'palm-lower-right': [10, 115],
      'wingtip-left': [-45 - 15 * SQRT2, 100 - 15 * SQRT2], // second wing bone at world 225
      'wingtip-right': [35 + 20 * SQRT2, 100 + 20 * SQRT2],
    });
  });
});

describe('extendRig', () => {
  const merged = extendRig(MANNEQUIN_RIG, TAIL_EXTENSION);
  const withBone = (parent: string): RigData => ({
    ...TAIL_EXTENSION,
    bones: TAIL_EXTENSION.bones.map((bone) => ({ ...bone, parent })),
  });

  it('keeps the base id and grafts bones, slots, attachments and anchors as data', () => {
    expect(merged.id).toBe('mannequin');
    const result = evaluate(loadRig(merged), { attachments: { body: 'body-armor' } });
    expectBones(result, { 'tail-1': [1, 0, 0, 1, 0, 90], 'tail-2': [0, 1, -1, 0, 20, 90] });
    expectAnchors(result, { 'tail-tip': [20, 105], crown: [0, 175] });
    expect(result.slots.map((slot) => [slot.id, slot.attachment])).toEqual([
      ['tail', 'tail-plain'],
      ['body', 'body-armor'],
      ['face', 'face-neutral'],
      ['held-right', null],
    ]);
  });

  it('leaves the base rig and its bones unchanged', () => {
    const base = evaluate(loadRig(MANNEQUIN_RIG), {});
    const extended = evaluate(loadRig(merged), {});
    expect(base.bones).toHaveLength(14);
    expect(extended.bones).toHaveLength(16);
    for (const bone of base.bones) {
      expect(extended.bones.find(({ id }) => id === bone.id)).toEqual(bone);
    }
    expect(MANNEQUIN_RIG.bones).toHaveLength(14);
  });

  it.each([
    ['bone', { bones: [{ ...MANNEQUIN_RIG.bones[2], parent: 'hips' }] }, 'bone id "spine"'],
    ['slot', { slots: [{ id: 'body', bone: 'tail-1', drawOrder: 9 }] }, 'slot id "body"'],
    ['attachment', { attachments: [{ id: 'staff', slot: 'tail' }] }, 'attachment id "staff"'],
    [
      'anchor',
      { anchors: [{ id: 'crown', bone: 'tail-2', position: { x: 0, y: 0 } }] },
      'anchor id "crown"',
    ],
  ])('rejects an id collision with a base %s', (_kind, change, fragment) => {
    const extension = { ...TAIL_EXTENSION, ...change } as RigData;
    expect(() => extendRig(MANNEQUIN_RIG, extension)).toThrow(
      `Rig extension "tail" cannot extend rig "mannequin": ${fragment} is already in the base`,
    );
  });

  it('rejects a graft onto an unknown parent when the merged rig is loaded', () => {
    expect(() => loadRig(extendRig(MANNEQUIN_RIG, withBone('nowhere')))).toThrow(
      'bone "tail-1" has unknown parent "nowhere"',
    );
  });

  it('rejects an extension with an unknown schemaVersion', () => {
    const extension = { ...TAIL_EXTENSION, schemaVersion: 2 } as unknown as RigData;
    expect(() => extendRig(MANNEQUIN_RIG, extension)).toThrow(
      'Unsupported rig extension schemaVersion 2',
    );
  });
});

describe('attachment switching', () => {
  const rig = loadRig(MANNEQUIN_RIG);

  it('uses the default, another attachment or none, per slot, from pose data', () => {
    expect(activeAttachments(evaluate(rig, {}))).toEqual({
      body: 'body-plain',
      face: 'face-neutral',
      'held-right': null,
    });
    expect(
      activeAttachments(
        evaluate(rig, { attachments: { body: 'body-robe', 'held-right': 'staff' } }),
      ),
    ).toEqual({ body: 'body-robe', face: 'face-neutral', 'held-right': 'staff' });
    expect(activeAttachments(evaluate(rig, { attachments: { face: null } }))).toEqual({
      body: 'body-plain',
      face: null,
      'held-right': null,
    });
  });

  it("rejects another slot's attachment, an unknown attachment and an unknown slot", () => {
    expect(() => evaluate(rig, { attachments: { face: 'staff' } })).toThrow(
      'Pose selects attachment "staff" for slot "face" of rig "mannequin", but it does not belong to that slot',
    );
    expect(() => evaluate(rig, { attachments: { face: 'mask' } })).toThrow('attachment "mask"');
    expect(() => evaluate(rig, { attachments: { pocket: null } })).toThrow(
      'Pose names unknown slot "pocket" of rig "mannequin"',
    );
  });
});

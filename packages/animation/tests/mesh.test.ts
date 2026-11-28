import { degToRad, type Vec2 } from '@mortal-doctrine/math';
import { evaluate, loadRig, type Pose } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';
import { describe, expect, it } from 'vitest';
import { loadMesh, MAX_INFLUENCES, skin, WEIGHT_TOLERANCE } from '../src/index';
import { INVALID_MESHES, LIMB_MESH, LIMB_RIG } from '../src/testing';

const LIMB = loadRig(LIMB_RIG);
const MESH = loadMesh(LIMB, LIMB_MESH);

const skinned = (pose: Pose) => skin(MESH, evaluate(LIMB, pose).bones);

function expectPoints(actual: readonly Vec2[], expected: Readonly<Record<number, Vec2>>) {
  for (const [index, { x, y }] of Object.entries(expected)) {
    const point = actual[Number(index)];
    expect(point?.x).toBeCloseTo(x, 9);
    expect(point?.y).toBeCloseTo(y, 9);
  }
}

const LOWER_90: Pose = { bones: { lower: { rotation: degToRad(90) } } };
const UPPER_90: Pose = { bones: { upper: { rotation: degToRad(90) } } };

describe('skin', () => {
  it('returns every vertex at its authored position at the rest pose', () => {
    const rest = skinned({});
    expect(rest).toHaveLength(LIMB_MESH.vertices.length);
    expectPoints(rest, Object.fromEntries(LIMB_MESH.vertices.map((v, i) => [i, v.position])));
  });

  it('moves a vertex weighted 1.0 to one bone exactly with that bone', () => {
    // upper turned 90 about (-60, 100): bone-local (x, y) lands at (-60 - y, 100 + x).
    // lower then starts at (-60, 160), also pointing up.
    expectPoints(skinned(UPPER_90), {
      0: { x: -70, y: 100 }, // (-60, 110): local (0, 10)
      1: { x: -50, y: 100 }, // (-60, 90): local (0, -10)
      8: { x: -70, y: 220 }, // (60, 110): lower-local (60, 10) lands at (-60 - 10, 160 + 60)
      9: { x: -50, y: 220 }, // (60, 90): lower-local (60, -10)
    });
    // lower turned 90 about the joint (0, 100): lower-local (x, y) lands at (-y, 100 + x).
    expectPoints(skinned(LOWER_90), {
      0: { x: -60, y: 110 },
      1: { x: -60, y: 90 },
      8: { x: -10, y: 160 },
      9: { x: 10, y: 160 },
    });
  });

  it('blends vertices across the joint by their weights', () => {
    // With lower at 90 degrees, upper keeps each vertex where it is; lower moves a vertex with
    // lower-local (x, y) to (-y, 100 + x).
    expectPoints(skinned(LOWER_90), {
      // x -10, 0.75 upper: 0.75 (-10, 110) + 0.25 (-10, 90); 0.75 (-10, 90) + 0.25 (10, 90).
      2: { x: -10, y: 105 },
      3: { x: -5, y: 90 },
      // x 0, 0.5 / 0.5: 0.5 (0, 110) + 0.5 (-10, 100); 0.5 (0, 90) + 0.5 (10, 100).
      4: { x: -5, y: 105 },
      5: { x: 5, y: 95 },
      // x 10, 0.25 upper: 0.25 (10, 110) + 0.75 (-10, 110); 0.25 (10, 90) + 0.75 (10, 110).
      6: { x: -5, y: 110 },
      7: { x: 10, y: 105 },
    });
  });

  it('is deterministic and leaves its inputs alone', () => {
    const bones = evaluate(LIMB, LOWER_90).bones;
    const copy: unknown = JSON.parse(JSON.stringify(bones));
    expect(skin(MESH, bones)).toEqual(skin(MESH, bones));
    expect(bones).toEqual(copy);
  });

  it('throws for bones of another rig', () => {
    expect(() => skin(MESH, evaluate(loadRig(MANNEQUIN_RIG), {}).bones)).toThrow(
      'Mesh "limb-skin": bones are not of rig "limb"',
    );
  });
});

describe('loadMesh', () => {
  it('loads the limb fixture', () => {
    expect(MESH.rig).toBe('limb');
    expect(MESH.attachment).toBe('limb-skin');
    expect(MESH.vertices).toHaveLength(10);
    expect(MESH.triangles).toHaveLength(8);
    expect(MAX_INFLUENCES).toBe(4);
  });

  it.each(INVALID_MESHES)('rejects $name', ({ rig, data, message }) => {
    expect(() => loadMesh(loadRig(rig), data)).toThrow(message);
  });

  it('lists every problem in one error', () => {
    const data = {
      ...LIMB_MESH,
      attachment: 'limb-scaly',
      triangles: [[0, 1, 1]],
    };
    expect(() => loadMesh(LIMB, data)).toThrow(
      'Invalid mesh "limb-scaly": unknown attachment "limb-scaly" of rig "limb"; triangle 0 repeats an index',
    );
  });

  it(`accepts weights within ${WEIGHT_TOLERANCE} of 1 and rejects them beyond`, () => {
    const withLowerWeight = (lower: number) => ({
      ...LIMB_MESH,
      vertices: LIMB_MESH.vertices.map((vertex, i) =>
        i === 4
          ? {
              ...vertex,
              weights: [
                { bone: 'upper', weight: 0.5 },
                { bone: 'lower', weight: lower },
              ],
            }
          : vertex,
      ),
    });
    expect(() => loadMesh(LIMB, withLowerWeight(0.5 + 0.9 * WEIGHT_TOLERANCE))).not.toThrow();
    expect(() => loadMesh(LIMB, withLowerWeight(0.5 - 0.9 * WEIGHT_TOLERANCE))).not.toThrow();
    expect(() => loadMesh(LIMB, withLowerWeight(0.5 + 1.1 * WEIGHT_TOLERANCE))).toThrow(
      'vertex 4 weights sum to',
    );
    expect(() => loadMesh(LIMB, withLowerWeight(0.5 - 1.1 * WEIGHT_TOLERANCE))).toThrow(
      'vertex 4 weights sum to',
    );
  });
});

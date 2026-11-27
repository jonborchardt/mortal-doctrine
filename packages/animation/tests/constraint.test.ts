import { apply, degToRad, lerpAngle, type Vec2 } from '@mortal-doctrine/math';
import { evaluate, loadRig, type Rig, type RigData } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';
import { describe, expect, it } from 'vitest';
import {
  blend,
  blendStage,
  constraintStage,
  loadClip,
  loadConstraints,
  runPipeline,
  sample,
  type AnimatedPose,
  type ConstraintsData,
} from '../src/index';
import {
  INVALID_CONSTRAINTS,
  MANNEQUIN_REACH,
  OFFSET_CHAIN_RIG,
  RAISE_STAFF,
  WALK_CYCLE,
} from '../src/testing';

/** The reach tolerance the README documents, in world units. */
const TOLERANCE = 1e-6;
const TAU = 2 * Math.PI;

type ConstraintData = ConstraintsData['constraints'][number];

const MANNEQUIN = loadRig(MANNEQUIN_RIG);
const OFFSET_CHAIN = loadRig(OFFSET_CHAIN_RIG);

const stageFor = (rig: Rig, ...constraints: readonly ConstraintData[]) =>
  constraintStage(rig, loadConstraints({ schemaVersion: 1, id: 'test', constraints }));

const ik = (
  parent: string,
  child: string,
  target: Vec2,
  bend: 1 | -1,
  mix = 1,
): ConstraintData => ({ type: 'two-bone-ik', parent, child, target, bend, mix });

/** World origin and tip of a bone in a pose. */
function ends(rig: Rig, pose: AnimatedPose, bone: string) {
  const transform = evaluate(rig, pose).bones.find(({ id }) => id === bone)?.transform;
  const length = rig.bones.find(({ id }) => id === bone)?.length;
  if (!transform || length === undefined) throw new Error(`no bone "${bone}"`);
  return {
    origin: { x: transform.tx, y: transform.ty },
    tip: apply(transform, { x: length, y: 0 }),
  };
}

const rotationOf = (pose: AnimatedPose, bone: string) => pose.bones?.[bone]?.rotation ?? NaN;
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const polar = (origin: Vec2, radius: number, degrees: number): Vec2 => ({
  x: origin.x + radius * Math.cos(degToRad(degrees)),
  y: origin.y + radius * Math.sin(degToRad(degrees)),
});

function expectFinite(pose: AnimatedPose) {
  for (const [bone, channels] of Object.entries(pose.bones ?? {})) {
    expect(Number.isFinite(channels.rotation), `${bone}.rotation ${channels.rotation}`).toBe(true);
  }
}

const CHAINS = [
  // l1 is the parent-origin to child-origin distance, l2 the child's length.
  { name: 'mannequin right arm', rig: MANNEQUIN, parent: 'upper-arm-right', child: 'forearm-right', l1: 30, l2: 28 }, // prettier-ignore
  { name: 'mannequin left leg (equal segments)', rig: MANNEQUIN, parent: 'thigh-left', child: 'shin-left', l1: 45, l2: 45 }, // prettier-ignore
  // The joint is at (12, 9) in the parent, whose own length is 20.
  { name: 'offset chain', rig: OFFSET_CHAIN, parent: 'upper', child: 'lower', l1: 15, l2: 10 },
] as const;
const DIRECTIONS = [0, 100, 200, 310];

describe.each(CHAINS)('two-bone IK reachability: $name', ({ rig, parent, child, l1, l2 }) => {
  const root = ends(rig, {}, parent).origin;
  const solve = (target: Vec2, bend: 1 | -1) => {
    const pose = stageFor(rig, ik(parent, child, target, bend))(rig, {});
    return { elbow: ends(rig, pose, child).origin, effector: ends(rig, pose, child).tip };
  };

  describe.each([1, -1] as const)('bend %i', (bend) => {
    it('reaches reachable targets with the elbow on the requested side', () => {
      for (const direction of DIRECTIONS) {
        for (const fraction of [0.05, 0.5, 0.95, 0.999999]) {
          const inner = Math.abs(l1 - l2);
          const target = polar(root, inner + fraction * (l1 + l2 - inner), direction);
          const { elbow, effector } = solve(target, bend);
          expect(distance(effector, target)).toBeLessThan(TOLERANCE);
          expect(distance(elbow, root)).toBeCloseTo(l1, 9);
          expect(cross(minus(target, root), minus(elbow, root)) * bend).toBeGreaterThan(0);
        }
      }
    });

    it('extends fully toward targets beyond l1 + l2', () => {
      for (const direction of DIRECTIONS) {
        for (const factor of [1.0001, 1.5, 100]) {
          const { elbow, effector } = solve(polar(root, (l1 + l2) * factor, direction), bend);
          expect(distance(effector, polar(root, l1 + l2, direction))).toBeLessThan(TOLERANCE);
          // Collinear, pointing the same way.
          const first = minus(elbow, root);
          const second = minus(effector, elbow);
          expect(Math.abs(cross(first, second))).toBeLessThan(TOLERANCE);
          expect(dot(first, second)).toBeCloseTo(l1 * l2, 6);
        }
      }
    });

    it('folds fully toward targets closer than |l1 - l2|', () => {
      const inner = Math.abs(l1 - l2);
      for (const direction of DIRECTIONS) {
        // With equal segments the only such target is the root itself.
        const { elbow, effector } = solve(polar(root, inner / 2, direction), bend);
        expect(distance(effector, polar(root, inner, direction))).toBeLessThan(TOLERANCE);
        expect(dot(minus(elbow, root), minus(effector, elbow))).toBeCloseTo(-l1 * l2, 6);
      }
    });
  });
});

describe('angle limits', () => {
  const MIN = -30;
  const MAX = 45;
  const limit: ConstraintData = { type: 'limit', bone: 'forearm-right', min: MIN, max: MAX };
  const inRange = (rotation: number) => {
    expect(rotation).toBeGreaterThanOrEqual(degToRad(MIN));
    expect(rotation).toBeLessThanOrEqual(degToRad(MAX));
  };

  it.each([
    // [input degrees, expected degrees]
    [-200, 45], // 160 after wrapping: nearer the upper bound
    [-31, -30],
    [-30, -30],
    [0, 0],
    [45, 45],
    [46, 45],
    [170, 45],
    [190, -30], // -170 after wrapping: nearer the lower bound
    [360, 0],
    [-360, 0],
    [360 - 30, -30],
    [360 + 20, 20],
    [-360 - 20, -20],
    [360 + 50, 45],
    [-360 - 40, -30],
    [720 + 10, 10],
  ])('a rotation of %i degrees ends at %i', (input, expected) => {
    const pose = stageFor(MANNEQUIN, limit)(MANNEQUIN, {
      bones: { 'forearm-right': { rotation: degToRad(input) } },
    });
    inRange(rotationOf(pose, 'forearm-right'));
    expect(rotationOf(pose, 'forearm-right')).toBeCloseTo(degToRad(expected), 9);
  });

  it('limits a bone the pose does not name, from its rest rotation', () => {
    const stage = stageFor(MANNEQUIN, { type: 'limit', bone: 'thigh-left', min: 100, max: 170 });
    expect(rotationOf(stage(MANNEQUIN, {}), 'thigh-left')).toBe(degToRad(170)); // rest is 180
  });

  it('holds over IK and aim output, wherever the limit is in the list', () => {
    // Folding the arm onto the shoulder needs far more elbow bend than the limit allows.
    const reach = ik('upper-arm-right', 'forearm-right', { x: 14, y: 146 }, 1);
    const aim: ConstraintData = { type: 'aim', bone: 'head', target: { x: 80, y: 100 }, mix: 1 };
    const headLimit: ConstraintData = { type: 'limit', bone: 'head', min: -20, max: 20 };

    const unlimited = stageFor(MANNEQUIN, reach, aim)(MANNEQUIN, {});
    expect(Math.abs(rotationOf(unlimited, 'forearm-right'))).toBeGreaterThan(degToRad(MAX));
    expect(rotationOf(unlimited, 'head')).toBeLessThan(degToRad(-20));

    const orders = [
      [reach, aim, limit, headLimit],
      [limit, headLimit, reach, aim],
      [headLimit, aim, limit, reach],
    ];
    const results = orders.map((order) => stageFor(MANNEQUIN, ...order)(MANNEQUIN, {}));
    for (const pose of results) {
      inRange(rotationOf(pose, 'forearm-right'));
      expect(rotationOf(pose, 'forearm-right')).toBe(degToRad(MAX));
      expect(rotationOf(pose, 'head')).toBe(degToRad(-20));
      expect(pose).toEqual(results[0]);
    }
  });
});

describe('mix weights', () => {
  const target = { x: 50, y: 120 };
  const input: AnimatedPose = {
    bones: {
      'upper-arm-right': { rotation: degToRad(-100) },
      // More than a turn away from any solved value: a blend at 1 would land a turn off.
      head: { rotation: degToRad(700), scale: { x: 2, y: 2 } },
    },
    attachments: { face: 'face-angry' },
    drawOrder: ['face', 'body'],
  };
  const stageAt = (mix: number) =>
    stageFor(MANNEQUIN, ik('upper-arm-right', 'forearm-right', target, 1, mix), {
      type: 'aim',
      bone: 'head',
      target,
      mix,
    });
  const full = stageAt(1)(MANNEQUIN, input);

  it('mix 0 leaves the pose unchanged', () => {
    const pose = stageAt(0)(MANNEQUIN, input);
    expect(rotationOf(pose, 'upper-arm-right')).toBe(degToRad(-100));
    expect(rotationOf(pose, 'head')).toBe(degToRad(700));
    // Not named by the input: its rest rotation.
    expect(rotationOf(pose, 'forearm-right')).toBe(0);
    expect(evaluate(MANNEQUIN, pose)).toEqual(evaluate(MANNEQUIN, input));
  });

  it('mix 1 writes the solved rotations exactly, whatever the incoming rotation', () => {
    // The head's parent space is the spine's: world turned by 90 degrees about (0, 150).
    const head = ends(MANNEQUIN, {}, 'head').origin;
    expect(rotationOf(full, 'head')).toBe(Math.atan2(-(target.x - head.x), target.y - head.y));
    expect(distance(ends(MANNEQUIN, full, 'forearm-right').tip, target)).toBeLessThan(TOLERANCE);

    const fromRest = stageAt(1)(MANNEQUIN, {});
    for (const bone of ['upper-arm-right', 'forearm-right', 'head']) {
      expect(rotationOf(full, bone)).toBe(rotationOf(fromRest, bone));
    }

    // One full turn off the solved values: still the solved values, not an equivalent angle.
    const turned = stageAt(1)(MANNEQUIN, {
      bones: {
        'upper-arm-right': { rotation: rotationOf(full, 'upper-arm-right') + TAU },
        'forearm-right': { rotation: rotationOf(full, 'forearm-right') - TAU },
        head: { rotation: rotationOf(full, 'head') + TAU },
      },
    });
    for (const bone of ['upper-arm-right', 'forearm-right', 'head']) {
      expect(rotationOf(turned, bone)).toBe(rotationOf(full, bone));
    }
  });

  it('passes everything but the constrained rotations through', () => {
    expect(full.attachments).toBe(input.attachments);
    expect(full.drawOrder).toBe(input.drawOrder);
    expect(full.bones?.head?.scale).toEqual({ x: 2, y: 2 });
    expect(Object.keys(full.bones ?? {}).sort()).toEqual([
      'forearm-right',
      'head',
      'upper-arm-right',
    ]);
  });

  it.each([0.25, 0.5, 0.75])('mix %f lies on the shorter arc', (mix) => {
    const pose = stageAt(mix)(MANNEQUIN, input);
    // The aim does not depend on the pose's other rotations, so the blend is checkable exactly.
    const from = degToRad(700);
    expect(rotationOf(pose, 'head')).toBe(lerpAngle(from, rotationOf(full, 'head'), mix));
    const wrappedTravel = Math.abs((rotationOf(full, 'head') - from) % TAU);
    const shorter = Math.min(wrappedTravel, TAU - wrappedTravel);
    expect(Math.abs(rotationOf(pose, 'head') - from)).toBeCloseTo(shorter * mix, 9);

    // The hand moves part of the way to the target.
    const rest = distance(ends(MANNEQUIN, input, 'forearm-right').tip, target);
    const mixed = distance(ends(MANNEQUIN, pose, 'forearm-right').tip, target);
    expect(mixed).toBeGreaterThan(TOLERANCE);
    expect(mixed).toBeLessThan(rest);
  });
});

describe('degenerate cases', () => {
  const chain = (jointX: number, length: number, scale = 1): RigData => ({
    schemaVersion: 1,
    id: 'degenerate',
    bones: [
      { id: 'base', translation: { x: 3, y: 4 }, rotation: 0, scale: { x: scale, y: scale }, length: 0 }, // prettier-ignore
      { id: 'upper', parent: 'base', translation: { x: 0, y: 0 }, rotation: 10, scale: { x: 1, y: 1 }, length: 5 }, // prettier-ignore
      { id: 'lower', parent: 'upper', translation: { x: jointX, y: 0 }, rotation: 20, scale: { x: 1, y: 1 }, length }, // prettier-ignore
    ],
    slots: [],
    attachments: [],
    anchors: [],
  });
  const ROOT = { x: 3, y: 4 };
  const ELSEWHERE = { x: 9, y: -2 };

  const cases: readonly (readonly [string, RigData, Vec2])[] = [
    ['a zero-length child bone', chain(5, 0), ELSEWHERE],
    ['a zero-length first segment', chain(0, 5), ELSEWHERE],
    ['both segments zero', chain(0, 0), ELSEWHERE],
    ['both segments zero and the target at the root', chain(0, 0), ROOT],
    ['a target at the root, unequal segments', chain(5, 3), ROOT],
    ['a target at the root, equal segments', chain(5, 5), ROOT],
    ['a zero-scale ancestor', chain(5, 5, 0), ELSEWHERE],
  ];

  it.each(cases)('IK with %s is finite and repeatable', (_, data, target) => {
    const rig = loadRig(data);
    for (const bend of [1, -1] as const) {
      for (const mix of [0.5, 1]) {
        const run = () => stageFor(rig, ik('upper', 'lower', target, bend, mix))(rig, {});
        const pose = run();
        expectFinite(pose);
        expect(run()).toEqual(pose);
        for (const { transform } of evaluate(rig, pose).bones) {
          expect(Object.values(transform).every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('IK with a zero-length child still puts the joint on a reachable target', () => {
    const rig = loadRig(chain(5, 0));
    const target = { x: 3 + 3, y: 4 + 4 }; // 5 from the root
    const pose = stageFor(rig, ik('upper', 'lower', target, 1))(rig, {});
    expect(distance(ends(rig, pose, 'lower').tip, target)).toBeLessThan(TOLERANCE);
  });

  it('aim at the bone origin keeps the incoming rotation', () => {
    const head = ends(MANNEQUIN, {}, 'head').origin;
    const stage = stageFor(MANNEQUIN, { type: 'aim', bone: 'head', target: head, mix: 1 });
    const pose = stage(MANNEQUIN, { bones: { head: { rotation: 0.3 } } });
    expectFinite(pose);
    expect(rotationOf(pose, 'head')).toBe(0.3);
    expect(stage(MANNEQUIN, { bones: { head: { rotation: 0.3 } } })).toEqual(pose);

    // On a root bone, whose origin is its own translation.
    const rig = loadRig(chain(5, 5));
    const rooted = stageFor(rig, { type: 'aim', bone: 'base', target: ROOT, mix: 1 })(rig, {});
    expectFinite(rooted);
    expect(rooted).toEqual({ bones: {} });
  });
});

describe('determinism and the pipeline', () => {
  const constraints = loadConstraints(MANNEQUIN_REACH);
  const walk = sample(loadClip(WALK_CYCLE), 12.5);
  const raise = sample(loadClip(RAISE_STAFF), 20);

  it('gives the same output twice and does not mutate its inputs', () => {
    const poseBefore = JSON.stringify(walk);
    const constraintsBefore = JSON.stringify(constraints);
    const dataBefore = JSON.stringify(MANNEQUIN_REACH);
    const first = constraintStage(MANNEQUIN, constraints)(MANNEQUIN, walk);
    const second = constraintStage(MANNEQUIN, loadConstraints(MANNEQUIN_REACH))(MANNEQUIN, walk);
    expect(second).toEqual(first);
    expect(JSON.stringify(walk)).toBe(poseBefore);
    expect(JSON.stringify(constraints)).toBe(constraintsBefore);
    expect(JSON.stringify(MANNEQUIN_REACH)).toBe(dataBefore);
  });

  it('runs as a pipeline stage after a blend stage', () => {
    const stage = constraintStage(MANNEQUIN, constraints);
    const piped = runPipeline(MANNEQUIN, walk, [blendStage(raise, 0.5), stage]);
    expect(piped).toEqual(stage(MANNEQUIN, blend(MANNEQUIN, walk, raise, 0.5)));
    // The fixture's hand reaches its target and its head stops at the limit.
    const hand = ends(MANNEQUIN, piped, 'forearm-right').tip;
    expect(distance(hand, { x: 50, y: 120 })).toBeLessThan(TOLERANCE);
    expect(rotationOf(piped, 'head')).toBe(degToRad(-40));
    expect(piped.drawOrder).toEqual(['held-right', 'body', 'face']);
  });
});

describe('validation', () => {
  it('loads the fixture, converting limit angles to radians', () => {
    const { id, constraints } = loadConstraints(MANNEQUIN_REACH);
    expect(id).toBe('mannequin-reach');
    expect(constraints[2]).toEqual({
      type: 'limit',
      bone: 'forearm-right',
      min: degToRad(-150),
      max: degToRad(150),
    });
    expect(constraints[0]).toEqual(MANNEQUIN_REACH.constraints[0]);
    // Plain data: it survives a JSON round trip.
    expect(loadConstraints(JSON.parse(JSON.stringify(MANNEQUIN_REACH)))).toEqual({
      id,
      constraints,
    });
  });

  it.each(INVALID_CONSTRAINTS)('loadConstraints rejects $name', ({ data, message }) => {
    expect(() => loadConstraints(data)).toThrow(message);
  });

  it('the stage factory rejects a bone the rig does not have', () => {
    const message = 'Constraints "test" name unknown bone "tail" of rig "mannequin"';
    expect(() =>
      stageFor(MANNEQUIN, { type: 'aim', bone: 'tail', target: { x: 0, y: 0 }, mix: 1 }),
    ).toThrow(message);
    expect(() => stageFor(MANNEQUIN, { type: 'limit', bone: 'tail', min: 0, max: 1 })).toThrow(
      message,
    );
    expect(() => stageFor(MANNEQUIN, ik('upper-arm-right', 'tail', { x: 0, y: 0 }, 1))).toThrow(
      message,
    );
  });

  it('the stage factory rejects an IK pair that is not parent and direct child', () => {
    for (const [parent, child] of [
      ['upper-arm-right', 'hand-right'], // grandchild
      ['forearm-right', 'upper-arm-right'], // reversed
      ['upper-arm-right', 'upper-arm-right'],
    ] as const) {
      expect(() => stageFor(MANNEQUIN, ik(parent, child, { x: 0, y: 0 }, 1))).toThrow(
        `IK child "${child}" is not a direct child of "${parent}" in rig "mannequin"`,
      );
    }
  });
});

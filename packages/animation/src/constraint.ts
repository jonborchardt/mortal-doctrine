import {
  apply,
  degToRad,
  IDENTITY,
  invert,
  lerpAngle,
  type Transform,
  type Vec2,
} from '@mortal-doctrine/math';
import { evaluate, type Rig } from '@mortal-doctrine/rig';
import { z } from 'zod';
import type { PoseStage } from './blend';

const SCHEMA_VERSION = 1;
const TAU = 2 * Math.PI;
/** Closer to its bone's origin than this, an aim target is treated as on it. */
const AIM_DEAD_ZONE = 1e-9;

const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  error: (issue) => `id ${JSON.stringify(issue.input)} must be kebab-case`,
});
const vec2Schema = z.object({ x: z.number(), y: z.number() }).readonly();
const mixSchema = z.number().min(0).max(1);

const constraintSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('two-bone-ik'),
      parent: idSchema,
      /** A direct child of `parent`. Its tip, local `(length, 0)`, is the end effector. */
      child: idSchema,
      /** World space (rig space, +y up). */
      target: vec2Schema,
      /** Which side of the root-to-target line the middle joint is on: 1 = left of it. */
      bend: z.union([z.literal(1), z.literal(-1)], { error: 'bend must be 1 or -1' }),
      mix: mixSchema,
    })
    .readonly(),
  z
    .object({
      type: z.literal('aim'),
      /** Its local +x axis turns toward `target`. */
      bone: idSchema,
      /** World space (rig space, +y up). */
      target: vec2Schema,
      mix: mixSchema,
    })
    .readonly(),
  z
    .object({
      type: z.literal('limit'),
      bone: idSchema,
      /** Degrees, on the bone's local rotation. `min <= max`, less than a full turn apart. */
      min: z.number(),
      max: z.number(),
    })
    .readonly(),
]);

/**
 * The authored form of a constraint list: limit angles in degrees. `loadConstraints` turns it
 * into runtime {@link Constraints}.
 */
export const constraintsDataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: idSchema,
    constraints: z.array(constraintSchema).readonly(),
  })
  .readonly();

export type ConstraintsData = z.infer<typeof constraintsDataSchema>;

/** The runtime form, built only by {@link loadConstraints}. Limit angles in radians. */
export type Constraints = Omit<ConstraintsData, 'schemaVersion'>;

/**
 * Validates authored constraint data and converts limit angles to radians. Throws one error
 * listing every problem found. It does not check the constraints against a rig:
 * {@link constraintStage} does.
 */
export function loadConstraints(data: unknown): Constraints {
  const version: unknown =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported constraints schemaVersion ${JSON.stringify(version)}; supported: ${SCHEMA_VERSION}`,
    );
  }
  const result = constraintsDataSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${['constraints', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid constraints: ${problems.join('; ')}`);
  }
  const { id, constraints } = result.data;

  const problems: string[] = [];
  const limited = new Set<string>();
  for (const constraint of constraints) {
    if (constraint.type !== 'limit') continue;
    const { bone, min, max } = constraint;
    if (min > max) problems.push(`limit on "${bone}" has min ${min} above max ${max}`);
    if (max - min >= 360) problems.push(`limit on "${bone}" spans a full turn or more`);
    if (limited.has(bone)) problems.push(`bone "${bone}" has more than one limit`);
    limited.add(bone);
  }
  if (problems.length > 0) throw new Error(`Invalid constraints "${id}": ${problems.join('; ')}`);

  return {
    id,
    constraints: constraints.map((constraint) =>
      constraint.type === 'limit'
        ? { ...constraint, min: degToRad(constraint.min), max: degToRad(constraint.max) }
        : constraint,
    ),
  };
}

/** The angle equal to `rotation` modulo a full turn that lies in `[min, max]`, else the nearer bound. */
function limitAngle(rotation: number, min: number, max: number): number {
  if (rotation >= min && rotation <= max) return rotation;
  const wrapped = min + ((((rotation - min) % TAU) + TAU) % TAU); // [min, min + TAU]
  if (wrapped <= max) return wrapped;
  return wrapped - max <= min + TAU - wrapped ? max : min;
}

/**
 * Local rotations of a two-bone chain whose root is at the origin, so that the child's tip
 * reaches `target` (all in the parent bone's parent space). `joint` is the child's local
 * translation. A target out of reach is clamped onto the nearest reachable distance along the
 * root-to-target ray: the chain is straight beyond `l1 + l2` and folded inside `|l1 - l2|`.
 */
function solveTwoBone(
  joint: Vec2,
  l2: number,
  target: Vec2,
  bend: 1 | -1,
): { readonly parent: number; readonly child: number } {
  const l1 = Math.hypot(joint.x, joint.y);
  const toward = Math.atan2(target.y, target.x); // 0 for a target at the root
  const distance = Math.min(Math.max(Math.hypot(target.x, target.y), Math.abs(l1 - l2)), l1 + l2);
  // The middle joint, in the frame whose +x axis points at the target: `along` the axis and
  // `across` it. Atan2 of these stays accurate near full extension, where acos does not.
  const along = distance === 0 ? 0 : (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const across = bend * Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const first = toward + Math.atan2(across, along);
  const second = l2 === 0 ? first : toward + Math.atan2(-across, distance - along);
  // The joint sits at angle atan2(joint) in the parent's local frame, not always on its +x axis.
  const parent = first - Math.atan2(joint.y, joint.x);
  return { parent, child: second - parent };
}

/**
 * Builds the constraint stage for `rig`: every `two-bone-ik` and `aim` constraint in list order,
 * then every `limit`, so no limit is exceeded afterwards wherever it sits in the list. The stage
 * writes only the `rotation` of the bones the constraints name. Pure. Throws here, not in the
 * stage, when a constraint names a bone the rig does not have or an IK `child` that is not a
 * direct child of its `parent`.
 */
export function constraintStage(rig: Rig, { id, constraints }: Constraints): PoseStage {
  const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
  const boneOf = (bone: string) => {
    const found = bones.get(bone);
    if (!found) {
      throw new Error(`Constraints "${id}" name unknown bone "${bone}" of rig "${rig.id}"`);
    }
    return found;
  };
  for (const constraint of constraints) {
    if (constraint.type !== 'two-bone-ik') boneOf(constraint.bone);
    else if (boneOf(constraint.child).parent !== boneOf(constraint.parent).id) {
      throw new Error(
        `Constraints "${id}": IK child "${constraint.child}" is not a direct child of "${constraint.parent}" in rig "${rig.id}"`,
      );
    }
  }
  const limits = constraints.filter((constraint) => constraint.type === 'limit');

  // The stage's own `rig` argument is ignored: the constraints were checked against this one.
  return (_, pose) => {
    const rotations = new Map<string, number>();
    const current = () => ({
      ...pose,
      bones: {
        ...pose.bones,
        ...Object.fromEntries(
          [...rotations].map(([bone, rotation]) => [bone, { ...pose.bones?.[bone], rotation }]),
        ),
      },
    });
    const rotationOf = (bone: string) =>
      rotations.get(bone) ?? pose.bones?.[bone]?.rotation ?? boneOf(bone).rest.rotation;
    const translationOf = (bone: string) =>
      pose.bones?.[bone]?.translation ?? boneOf(bone).rest.translation;
    const write = (bone: string, solved: number, mix: number) => {
      // lerpAngle at 1 is only equal modulo a full turn; at 0 it is exactly the incoming value.
      rotations.set(bone, mix === 1 ? solved : lerpAngle(rotationOf(bone), solved, mix));
    };
    /** `target` relative to `bone`'s origin, in the space of the bone's parent. */
    const targetFrom = (bone: string, target: Vec2): Vec2 | null => {
      const { parent } = boneOf(bone);
      const space: Transform | null =
        parent === null
          ? IDENTITY
          : invert(
              evaluate(rig, current()).bones.find((evaluated) => evaluated.id === parent)
                ?.transform ?? IDENTITY,
            );
      if (!space) return null; // A zero scale above the bone: nothing to aim in.
      const local = apply(space, target);
      const origin = translationOf(bone);
      return { x: local.x - origin.x, y: local.y - origin.y };
    };

    for (const constraint of constraints) {
      if (constraint.type === 'two-bone-ik') {
        const target = targetFrom(constraint.parent, constraint.target);
        if (!target) continue;
        const solved = solveTwoBone(
          translationOf(constraint.child),
          boneOf(constraint.child).length,
          target,
          constraint.bend,
        );
        write(constraint.parent, solved.parent, constraint.mix);
        write(constraint.child, solved.child, constraint.mix);
      } else if (constraint.type === 'aim') {
        const target = targetFrom(constraint.bone, constraint.target);
        // A target on the bone's origin has no direction: the bone keeps its rotation.
        if (!target || Math.hypot(target.x, target.y) < AIM_DEAD_ZONE) continue;
        write(constraint.bone, Math.atan2(target.y, target.x), constraint.mix);
      }
    }
    for (const { bone, min, max } of limits) {
      rotations.set(bone, limitAngle(rotationOf(bone), min, max));
    }
    return current();
  };
}

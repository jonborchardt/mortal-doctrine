import { lerpAngle, lerpVec2 } from '@mortal-doctrine/math';
import type { BonePose, Rig } from '@mortal-doctrine/rig';
import type { AnimatedPose } from './sample';

/**
 * Blends pose `a` toward pose `b` by `weight` in [0, 1]. Translation and scale interpolate
 * linearly, rotation along the shorter arc. A channel only one pose names blends against the
 * rig's rest value. Attachments and draw order are discrete: they come from `a` when
 * `weight < 0.5`, otherwise from `b`. Pure. Throws when `weight` is outside [0, 1] or a pose
 * names a bone the rig does not have.
 */
export function blend(rig: Rig, a: AnimatedPose, b: AnimatedPose, weight: number): AnimatedPose {
  if (!(weight >= 0 && weight <= 1)) {
    throw new Error(`Blend weight must be in [0, 1], got ${weight}`);
  }
  const bones: Record<string, Partial<BonePose>> = {};
  for (const id of new Set([...Object.keys(a.bones ?? {}), ...Object.keys(b.bones ?? {})])) {
    const rest = rig.bones.find((bone) => bone.id === id)?.rest;
    if (!rest) throw new Error(`Pose names unknown bone "${id}" of rig "${rig.id}"`);
    const from = a.bones?.[id] ?? {};
    const to = b.bones?.[id] ?? {};
    const named = (name: keyof BonePose) => from[name] !== undefined || to[name] !== undefined;
    bones[id] = {
      ...(named('translation') && {
        translation: lerpVec2(
          from.translation ?? rest.translation,
          to.translation ?? rest.translation,
          weight,
        ),
      }),
      ...(named('rotation') && {
        rotation: lerpAngle(from.rotation ?? rest.rotation, to.rotation ?? rest.rotation, weight),
      }),
      ...(named('scale') && {
        scale: lerpVec2(from.scale ?? rest.scale, to.scale ?? rest.scale, weight),
      }),
    };
  }
  const { attachments, drawOrder } = weight < 0.5 ? a : b;
  return { bones, ...(attachments && { attachments }), ...(drawOrder && { drawOrder }) };
}

/**
 * One step of the pose pipeline: a pure function from a pose to the next pose. Stages run after
 * `sample` and before the rig's `evaluate`.
 */
export type PoseStage = (rig: Rig, pose: AnimatedPose) => AnimatedPose;

/** Applies `stages` to `pose` in list order. An empty list returns `pose` itself. */
export function runPipeline(
  rig: Rig,
  pose: AnimatedPose,
  stages: readonly PoseStage[],
): AnimatedPose {
  return stages.reduce((current, stage) => stage(rig, current), pose);
}

/** The blend layer as a stage: blends the incoming pose toward `other` by `weight`. */
export function blendStage(other: AnimatedPose, weight: number): PoseStage {
  return (rig, pose) => blend(rig, pose, other, weight);
}

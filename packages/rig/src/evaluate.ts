import {
  apply,
  compose,
  IDENTITY,
  transformFromTrs,
  type Transform,
  type Vec2,
} from '@mortal-doctrine/math';
import type { Pose, Rig } from './rig';

export interface EvaluatedRig {
  /** In rig order: parents before children. */
  readonly bones: readonly { readonly id: string; readonly transform: Transform }[];
  /** In ascending draw order. A slot's transform is its bone's. */
  readonly slots: readonly {
    readonly id: string;
    readonly bone: string;
    readonly drawOrder: number;
    /** The active attachment, or `null` for none. */
    readonly attachment: string | null;
    readonly transform: Transform;
  }[];
  readonly anchors: readonly { readonly id: string; readonly position: Vec2 }[];
}

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * World transforms of every bone, slot and anchor for a pose. Pure: no unit conversion, no
 * mutation. Throws when the pose names an unknown bone or slot, or selects an attachment that
 * does not belong to the slot.
 */
export function evaluate(rig: Rig, pose: Pose): EvaluatedRig {
  const world = new Map<string, Transform>();
  const worldOf = (bone: string): Transform => {
    const transform = world.get(bone);
    if (!transform) {
      throw new Error(
        `Rig "${rig.id}": bone "${bone}" is missing or listed after a dependent; build rigs with loadRig`,
      );
    }
    return transform;
  };

  const bones = rig.bones.map(({ id, parent, rest }) => {
    const override = own(pose.bones, id);
    const local = transformFromTrs(
      override?.translation ?? rest.translation,
      override?.rotation ?? rest.rotation,
      override?.scale ?? rest.scale,
    );
    const transform = compose(parent === null ? IDENTITY : worldOf(parent), local);
    world.set(id, transform);
    return { id, transform };
  });
  for (const id of Object.keys(pose.bones ?? {})) {
    if (!world.has(id)) throw new Error(`Pose names unknown bone "${id}" of rig "${rig.id}"`);
  }

  for (const [slot, attachment] of Object.entries(pose.attachments ?? {})) {
    if (!rig.slots.some(({ id }) => id === slot)) {
      throw new Error(`Pose names unknown slot "${slot}" of rig "${rig.id}"`);
    }
    if (
      attachment !== null &&
      !rig.attachments.some((owned) => owned.id === attachment && owned.slot === slot)
    ) {
      throw new Error(
        `Pose selects attachment "${attachment}" for slot "${slot}" of rig "${rig.id}", but it does not belong to that slot`,
      );
    }
  }

  return {
    bones,
    slots: rig.slots.map((slot) => {
      const selected = own(pose.attachments, slot.id);
      return {
        ...slot,
        attachment: selected === undefined ? slot.attachment : selected,
        transform: worldOf(slot.bone),
      };
    }),
    anchors: rig.anchors.map(({ id, bone, position }) => ({
      id,
      position: apply(worldOf(bone), position),
    })),
  };
}

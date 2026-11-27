import { degToRad, type Vec2 } from '@mortal-doctrine/math';
import { z } from 'zod';

export const RIG_SCHEMA_VERSION = 1;

const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  error: (issue) => `id ${JSON.stringify(issue.input)} must be kebab-case`,
});
const vec2Schema = z.object({ x: z.number(), y: z.number() }).readonly();

/**
 * The authored form of a rig (or of a rig extension): rotations in degrees, y-up,
 * counter-clockwise positive. `loadRig` turns it into a runtime {@link Rig}.
 */
export const rigDataSchema = z
  .object({
    schemaVersion: z.literal(RIG_SCHEMA_VERSION),
    id: idSchema,
    bones: z
      .array(
        z
          .object({
            id: idSchema,
            /** Absent on the root bone only. */
            parent: idSchema.optional(),
            /** Local to the parent bone. */
            translation: vec2Schema,
            /** Degrees. */
            rotation: z.number(),
            scale: vec2Schema,
            /** Measured along the bone's local +x axis. */
            length: z.number().min(0),
          })
          .readonly(),
      )
      .readonly(),
    slots: z
      .array(
        z
          .object({
            id: idSchema,
            bone: idSchema,
            /** Lower draws first (further back). Unique within the rig. */
            drawOrder: z.int(),
            /** The attachment shown unless a pose says otherwise. Absent: none. */
            attachment: idSchema.optional(),
          })
          .readonly(),
      )
      .readonly(),
    attachments: z.array(z.object({ id: idSchema, slot: idSchema }).readonly()).readonly(),
    anchors: z
      .array(
        z
          .object({
            id: idSchema,
            bone: idSchema,
            /** Local to the bone. */
            position: vec2Schema,
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();

export type RigData = z.infer<typeof rigDataSchema>;

/**
 * Entities to add to a base rig, in the same shape as a rig. Every bone names a parent, which
 * may be a base bone or another extension bone.
 */
export type RigExtensionData = RigData;

/** A bone's local transform channels. Rotation in radians. */
export interface BonePose {
  readonly translation: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
}

/** The runtime form of a rig, built only by {@link loadRig}. Rotations in radians. */
export interface Rig {
  readonly id: string;
  /** Parents before children. */
  readonly bones: readonly {
    readonly id: string;
    readonly parent: string | null;
    readonly rest: BonePose;
    readonly length: number;
  }[];
  /** Ascending draw order. `attachment` is the default one. */
  readonly slots: readonly {
    readonly id: string;
    readonly bone: string;
    readonly drawOrder: number;
    readonly attachment: string | null;
  }[];
  readonly attachments: readonly { readonly id: string; readonly slot: string }[];
  readonly anchors: readonly {
    readonly id: string;
    readonly bone: string;
    readonly position: Vec2;
  }[];
}

/**
 * Partial local overrides. A channel that is present replaces the rest value of that channel
 * (it is not added to it); anything absent stays at rest. `{}` is the rest pose.
 */
export interface Pose {
  /** By bone id. Rotation in radians. */
  readonly bones?: Readonly<Record<string, Partial<BonePose>>>;
  /** By slot id: the attachment to show, or `null` for none. Absent slots use their default. */
  readonly attachments?: Readonly<Record<string, string | null>>;
}

function parse(kind: string, data: unknown): RigData {
  const version: unknown =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  if (version !== RIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported ${kind} schemaVersion ${JSON.stringify(version)}; supported: ${RIG_SCHEMA_VERSION}`,
    );
  }
  const result = rigDataSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${[kind, ...issue.path.map(String)].join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid ${kind}: ${problems.join('; ')}`);
  }
  return result.data;
}

function indexById<T extends { readonly id: string }>(
  kind: string,
  items: readonly T[],
  problems: string[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (byId.has(item.id)) problems.push(`duplicate ${kind} id "${item.id}"`);
    else byId.set(item.id, item);
  }
  return byId;
}

/**
 * Validates authored rig data (schema, then structure) and converts it to the runtime form.
 * This is the only place degrees become radians. Throws one error listing every problem found.
 */
export function loadRig(data: unknown): Rig {
  const rig = parse('rig', data);
  const problems: string[] = [];
  const bones = indexById('bone', rig.bones, problems);
  const slots = indexById('slot', rig.slots, problems);
  const attachments = indexById('attachment', rig.attachments, problems);
  indexById('anchor', rig.anchors, problems);

  const roots = rig.bones.filter((bone) => bone.parent === undefined);
  if (roots.length !== 1) {
    const found = roots.map((bone) => `"${bone.id}"`).join(', ');
    problems.push(
      `expected exactly one root bone (a bone with no parent), found ${roots.length}${found && `: ${found}`}`,
    );
  }
  const depths = new Map<string, number>();
  for (const bone of rig.bones) {
    let depth = 0;
    for (let current = bone; current.parent !== undefined; depth++) {
      const parent = bones.get(current.parent);
      if (!parent) {
        if (current === bone) {
          problems.push(`bone "${bone.id}" has unknown parent "${current.parent}"`);
        }
        break;
      }
      if (depth > rig.bones.length) {
        problems.push(`bone "${bone.id}" has a cycle in its parent chain`);
        break;
      }
      current = parent;
    }
    depths.set(bone.id, depth);
  }

  const drawOrders = new Map<number, string>();
  for (const slot of rig.slots) {
    if (!bones.has(slot.bone)) {
      problems.push(`slot "${slot.id}" names unknown bone "${slot.bone}"`);
    }
    if (slot.attachment !== undefined) {
      const attachment = attachments.get(slot.attachment);
      if (!attachment) {
        problems.push(`slot "${slot.id}" has unknown default attachment "${slot.attachment}"`);
      } else if (attachment.slot !== slot.id) {
        problems.push(
          `slot "${slot.id}" default attachment "${attachment.id}" belongs to slot "${attachment.slot}"`,
        );
      }
    }
    const sharing = drawOrders.get(slot.drawOrder);
    if (sharing === undefined) drawOrders.set(slot.drawOrder, slot.id);
    else if (sharing !== slot.id) {
      problems.push(`slots "${sharing}" and "${slot.id}" share draw order ${slot.drawOrder}`);
    }
  }
  for (const attachment of rig.attachments) {
    if (!slots.has(attachment.slot)) {
      problems.push(`attachment "${attachment.id}" names unknown slot "${attachment.slot}"`);
    }
  }
  for (const anchor of rig.anchors) {
    if (!bones.has(anchor.bone)) {
      problems.push(`anchor "${anchor.id}" names unknown bone "${anchor.bone}"`);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid rig "${rig.id}": ${problems.join('; ')}`);

  const depthOf = (id: string) => depths.get(id) ?? 0;
  return {
    id: rig.id,
    bones: rig.bones
      .map((bone) => ({
        id: bone.id,
        parent: bone.parent ?? null,
        rest: {
          translation: bone.translation,
          rotation: degToRad(bone.rotation),
          scale: bone.scale,
        },
        length: bone.length,
      }))
      .sort((a, b) => depthOf(a.id) - depthOf(b.id)),
    slots: rig.slots
      .map((slot) => ({ ...slot, attachment: slot.attachment ?? null }))
      .sort((a, b) => a.drawOrder - b.drawOrder),
    attachments: rig.attachments,
    anchors: rig.anchors,
  };
}

const KINDS = ['bones', 'slots', 'attachments', 'anchors'] as const;

/**
 * Grafts an extension onto a base rig and returns the merged data, which keeps the base rig's
 * id. Additive only: an extension id that collides with a base bone, slot, attachment or anchor
 * throws. Pass the result to {@link loadRig}, which validates it like any other rig (for
 * example, that every grafted bone's parent exists).
 */
export function extendRig(base: RigData, extension: RigExtensionData): RigData {
  const added = parse('rig extension', extension);
  const problems: string[] = [];
  for (const kind of KINDS) {
    const taken = new Set(base[kind].map((entity: { readonly id: string }) => entity.id));
    for (const { id } of added[kind]) {
      if (taken.has(id)) problems.push(`${kind.slice(0, -1)} id "${id}" is already in the base`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Rig extension "${added.id}" cannot extend rig "${base.id}": ${problems.join('; ')}`,
    );
  }
  return {
    ...base,
    bones: [...base.bones, ...added.bones],
    slots: [...base.slots, ...added.slots],
    attachments: [...base.attachments, ...added.attachments],
    anchors: [...base.anchors, ...added.anchors],
  };
}

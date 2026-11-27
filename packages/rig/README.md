# @mortal-doctrine/rig

**Layer:** `animation` · **May depend on:** `math`, `zod`.

Defines hierarchical 2D rigs of any shape as validated data and evaluates a pose to world
transforms. Pure and headless: no DOM, Pixi, React or Node APIs. Nothing here knows a bone name;
a rig declares its own bones, slots, attachments and anchors
(`docs/content-conventions.md#skeletons-are-per-character`).

**Non-goals:** keyframes and timing (M1.08), IK and constraints (M1.09), rendering (M1.10), mesh
skinning (M1.16), textures and attachment art, pose blending or interpolation, per-slot
attachment offsets, shear, inherit flags, extensions that modify or remove base entities, a rig
file format on disk.

**Never feed these results into simulation state.** They are float math
(`@mortal-doctrine/math`), for animation and presentation only.

## API

| Export                         | Purpose                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `rigDataSchema`, `RigData`     | Zod schema and type of authored rig data (degrees), `schemaVersion: 1`                       |
| `RIG_SCHEMA_VERSION`           | The supported `schemaVersion` (`1`)                                                          |
| `loadRig(data)`                | Validates `RigData` and returns a runtime `Rig` (radians); throws listing every problem      |
| `extendRig(base, extension)`   | Merges an extension (a `RigData` of entities to add) into base `RigData`; then `loadRig` it  |
| `evaluate(rig, pose)`          | World transforms per bone and slot, world position per anchor, active attachment per slot    |
| `Rig`, `Pose`, `BonePose`      | Runtime types (radians)                                                                      |
| `EvaluatedRig`                 | Result of `evaluate`                                                                         |
| `@mortal-doctrine/rig/testing` | `MANNEQUIN_RIG`, `NON_HUMANOID_RIG` (four arms, two wings), `TAIL_EXTENSION`, `INVALID_RIGS` |

## Rig data

```ts
{
  schemaVersion: 1,
  id: 'mannequin',
  bones: [{ id, parent?, translation: { x, y }, rotation, scale: { x, y }, length }],
  slots: [{ id, bone, drawOrder, attachment? }],   // attachment: the default, if any
  attachments: [{ id, slot }],
  anchors: [{ id, bone, position: { x, y } }],     // position is local to the bone
}
```

`loadRig` rejects, naming the offending id and the rule:

- an unknown `schemaVersion`, a missing or mistyped field, a negative `length`, a non-integer
  `drawOrder`;
- an id that is not kebab-case;
- a duplicate id within bones, slots, attachments or anchors;
- anything other than exactly one root (a bone with no `parent`);
- a bone whose parent is unknown, or whose parent chain has a cycle;
- a slot or anchor naming an unknown bone; an attachment naming an unknown slot;
- a slot whose default attachment is unknown or belongs to another slot;
- two slots with the same `drawOrder`.

## Units and axes

- **`RigData` is in degrees; `Rig` and `Pose` are in radians.** `loadRig` is the only place that
  converts. `evaluate` never converts units: callers that think in degrees (a lab control, a
  future keyframe loader) convert at their own edge.
- +x right, **+y up**, positive angles counter-clockwise (`docs/content-conventions.md`).
  Conversion to screen space is presentation's job.
- A bone points along its local **+x** axis; `length` is measured along it. A child placed at its
  parent's tip has `translation: { x: parent.length, y: 0 }`.
- A bone's local transform is scale, then rotation, then translation; its world transform is
  `compose(parentWorld, local)`.

## Pose

```ts
interface Pose {
  bones?: Record<boneId, { translation?: Vec2; rotation?: number; scale?: Vec2 }>;
  attachments?: Record<slotId, attachmentId | null>;
}
```

- **Partial.** A pose names any subset of bones, and for each any subset of channels. Whatever
  it does not name stays at the rig's rest value. `{}` is the rest pose.
- **Replace, not add.** A channel the pose names replaces the rest value of that channel. A
  rotation of `0` means "local rotation 0", not "no change".
- **Attachment switching is pose data.** A slot the pose does not mention shows its default
  attachment; an id switches to that attachment; `null` shows none.
- `evaluate` throws if the pose names an unknown bone or slot, or an attachment that does not
  belong to the slot.

## Evaluation result

- `bones`: `{ id, transform }` for every bone, parents before children.
- `slots`: `{ id, bone, drawOrder, attachment, transform }` in ascending draw order (back to
  front). A slot's transform is its bone's world transform; `attachment` is the active id or
  `null`.
- `anchors`: `{ id, position }`, the world position.

`Rig` values must come from `loadRig`: `evaluate` relies on its ordering and validation.

## Extensions

A character grafts extra bones (a tail, wings, a second pair of limbs) onto a base rig as data:

- **Additive only.** An extension adds bones, slots, attachments and anchors. It cannot modify or
  remove anything in the base, including a slot's default attachment. An extension id that
  collides with a base id of the same kind makes `extendRig` throw.
- Extension bones parent onto base bones or other extension bones. Extension attachments may
  target base slots. Draw orders are explicit integers, so an extension slot can sit anywhere in
  the order (negative is behind).
- The merged data keeps the base rig's `id`, and `loadRig` validates it like any other rig: a
  graft onto an unknown parent, a parentless extension bone (a second root) or a clashing draw
  order is rejected there.

## Usage

```ts
import { evaluate, extendRig, loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG, TAIL_EXTENSION } from '@mortal-doctrine/rig/testing';

const rig = loadRig(extendRig(MANNEQUIN_RIG, TAIL_EXTENSION));

const { bones, slots, anchors } = evaluate(rig, {
  bones: { 'forearm-right': { rotation: Math.PI / 2 } }, // radians, replaces the rest rotation
  attachments: { 'held-right': 'staff', face: null },
});

anchors.find((anchor) => anchor.id === 'grip-right')?.position; // about { x: 40, y: 179 }
slots.map((slot) => slot.attachment); // ['tail-plain', 'body-plain', null, 'staff']
```

## Integration

- **Consumers today:** the Studio Skeleton Lab (`/labs/skeleton`), which draws the result with a
  lab-local SVG debug view; `@mortal-doctrine/animation`, which produces `Pose` values; and
  `@mortal-doctrine/skeleton-renderer`, which draws `slots` in order at their transforms.

# @mortal-doctrine/animation

**Layer:** `animation` · **May depend on:** `math`, `rig`, `zod`.

Plays declarative keyframed clips on rigs: validates clip data, samples a clip at a time into a
pose for `@mortal-doctrine/rig`, blends two poses by a weight, and runs an ordered list of pose
stages, one of which applies pose constraints (two-bone IK, aim, angle limits), and skins mesh
attachments by weighted bones. Pure and headless: no DOM, Pixi, React or Node APIs. Nothing here knows a bone name.

**Non-goals:** multi-bone IK solvers (FABRIK, CCD), physics and springs, GPU or dual-quaternion
skinning, mesh keys in clips, a mesh file format on disk, Pixi drawing (M1.10), state machines,
clip queues, additive layers, masks, named easing presets, a clip file format on disk, validating
a clip against a rig at load time, animation-driven gameplay events.

**Animation never decides gameplay timing** (move frame data does), and these results are float
math: never feed them into simulation state.

## API

| Export                                     | Purpose                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `clipDataSchema`, `ClipData`               | Zod schema and authored type of a clip (degrees), `schemaVersion: 1`                             |
| `CLIP_SCHEMA_VERSION`                      | The supported `schemaVersion` (`1`)                                                              |
| `loadClip(data)`                           | Validates `ClipData` and returns a runtime `Clip` (radians); throws listing problems             |
| `key(frame, value, interpolation?)`        | Authoring helper: one key                                                                        |
| `defineClip(id, duration, content)`        | Authoring helper: `ClipData` with the current `schemaVersion`; `loop` defaults off               |
| `sample(clip, time)`                       | The pose at `time` (frames at 60 Hz, fractions allowed)                                          |
| `blend(rig, a, b, weight)`                 | Pose `a` blended toward pose `b`                                                                 |
| `PoseStage`, `runPipeline(rig, pose, s)`   | A stage is `(rig, pose) => pose`; the pipeline applies stages in list order                      |
| `blendStage(other, weight)`                | The blend layer as a stage                                                                       |
| `constraintsDataSchema`, `ConstraintsData` | Zod schema and authored type of a constraint list (degrees), `schemaVersion: 1`                  |
| `loadConstraints(data)`                    | Validates `ConstraintsData` and returns runtime `Constraints` (radians); throws listing problems |
| `constraintStage(rig, constraints)`        | The constraint stage for a rig; throws when the constraints do not fit the rig                   |
| `orderSlots(slots, drawOrder)`             | Applies a pose's draw order to `evaluate(...).slots`                                             |
| `AnimatedPose`                             | Rig `Pose` plus optional `drawOrder` (slot ids, back to front)                                   |
| `Clip`, `Key`, `Interpolation`             | Runtime types (radians)                                                                          |
| `Constraints`                              | Runtime type of a constraint list (radians)                                                      |
| `meshDataSchema`, `MeshData`               | Zod schema and authored type of a mesh attachment, `schemaVersion: 1`                            |
| `MESH_SCHEMA_VERSION`                      | The supported mesh `schemaVersion` (`1`)                                                         |
| `loadMesh(rig, data)`                      | Validates `MeshData` against a rig and returns a runtime `Mesh`; throws listing problems         |
| `skin(mesh, bones)`                        | Deformed rig-space vertex positions for `evaluate(rig, pose).bones`                              |
| `MAX_INFLUENCES`, `WEIGHT_TOLERANCE`       | `4` bones per vertex; weights must sum to 1 within `1e-6`                                        |
| `Mesh`                                     | Runtime mesh type, bound to the rig it was loaded for                                            |
| `@mortal-doctrine/animation/testing`       | `WALK_CYCLE`, `RAISE_STAFF` (mannequin), `WING_FLAP` (non-humanoid), `INVALID_CLIPS`, `SMOOTH`   |
| `@mortal-doctrine/animation/testing`       | Constraints: `MANNEQUIN_REACH` (mannequin), `OFFSET_CHAIN_RIG`, `INVALID_CONSTRAINTS`            |
| `@mortal-doctrine/animation/testing`       | Meshes: `LIMB_RIG` (two bones), `LIMB_MESH` (quad strip across the joint), `INVALID_MESHES`      |

## Clip data

```ts
{
  schemaVersion: 1,
  id: 'walk-cycle',
  duration: 32,                 // integer frames at 60 Hz, at least 1
  loop: true,
  bones: {                      // optional; by bone id, any subset of channels
    'thigh-left': {
      rotation: [{ frame: 0, value: 205, interpolation: 'linear' }, ...],   // degrees
      translation: [{ frame: 0, value: { x: 0, y: 90 } }, ...],
      scale: [{ frame: 0, value: { x: 1, y: 1 } }, ...],
    },
  },
  attachments: { face: [{ frame: 10, attachment: 'face-angry' }] },   // optional; null = none
  drawOrder: [{ frame: 10, slots: ['held-right', 'body', 'face'] }],  // optional; back to front
}
```

`loadClip` rejects, naming the problem: an unknown `schemaVersion`; a missing or mistyped field; a
key frame that is not a non-negative integer or is beyond `duration`; key frames in a channel that
are not strictly ascending (unsorted or duplicate); an empty channel; a `duration` below 1; an id
that is not kebab-case; an interpolation that is not `'step'`, `'linear'` or
`{ bezier: [x1, y1, x2, y2] }` with x1 and x2 in [0, 1]; a draw-order key listing a slot twice.

`ClipData` is in degrees; `Clip` is in radians. `loadClip` is the only place that converts.

## Sampling rules

- **Time** is a finite number of frames: integer frame plus fractional alpha. Non-finite throws.
- **Clamping:** a clip with `loop: false` clamps `time` to `[0, duration]`.
- **Looping:** a clip with `loop: true` wraps `time` modulo `duration`, so `duration` samples as
  frame 0 and negative times wrap too. There is no interpolation from the last key back to the
  first: author matching first and last keys for a seamless loop.
- **Interpolation** is per key and governs the segment from that key to the next (default
  `'linear'`). `'step'` holds the key's value until the next key's frame. `bezier` is a CSS-style
  cubic easing curve from (0, 0) to (1, 1), solved with a fixed iteration count.
- **On a key frame the value is exactly the key's value.** Before a channel's first key it holds
  the first key; after its last key it holds the last.
- **Rotation interpolates numerically** between key values inside a clip, so 90 to 450 is a full
  extra turn. (Blending two poses uses the shorter arc instead.)
- **Attachment and draw-order keys** take effect on their own frame: the active key is the last
  one with `frame <= time`. Before a slot's first attachment key the pose does not mention the
  slot (the rig default shows); before the first draw-order key the pose has no `drawOrder`.
- A sampled pose names only what the clip keys; everything else stays at rest in `evaluate`.

## Blend rules

`blend(rig, a, b, w)` with `w` in [0, 1] (anything else throws): translation and scale `lerp`,
rotation `lerpAngle` (shorter arc). At `w = 0` the result is pose `a` exactly; at `w = 1` it is
`b`, with rotations equal modulo a full turn. Poses are partial, so a channel only one pose names
blends against the rig's rest value, and a bone the rig does not have throws. Attachments and
draw order are discrete: from `a` when `w < 0.5`, otherwise from `b`.

## Pose pipeline

```
sample(clip, time) → stages in list order → evaluate(rig, pose) → orderSlots(slots, pose.drawOrder)
```

A stage is a pure `(rig, pose) => pose`. The stages shipped here are `blendStage` and
`constraintStage`. The constraint stage goes **after blend stages and before `evaluate`**.

## Constraints

Constraints are their own plain data, next to rig and clip data, naming rig bones by id:

```ts
{
  schemaVersion: 1,
  id: 'mannequin-reach',
  constraints: [
    // Turns `parent` and `child` so the child's tip, local (child.length, 0), is on `target`.
    { type: 'two-bone-ik', parent: 'upper-arm-right', child: 'forearm-right',
      target: { x: 50, y: 120 }, bend: 1, mix: 1 },
    // Turns the bone's local +x axis toward `target`.
    { type: 'aim', bone: 'head', target: { x: 50, y: 120 }, mix: 1 },
    // Keeps the bone's local rotation in [min, max] degrees.
    { type: 'limit', bone: 'head', min: -40, max: 40 },
  ],
}
```

`target` is a world-space point (rig space, +y up). `loadConstraints` rejects, naming the problem:
an unknown `schemaVersion`; a missing or mistyped field; an unknown `type`; a `mix` outside
[0, 1]; a `bend` that is not `1` or `-1`; an id that is not kebab-case; a limit with `min > max`
or spanning a full turn or more; two limits on one bone. `constraintStage(rig, constraints)`
throws when a constraint names a bone the rig does not have or an IK `child` that is not a direct
child of its `parent`. The stage it returns is for that rig and ignores the `rig` argument a
pipeline passes it.

- **Order.** The stage applies every `two-bone-ik` and `aim` constraint in list order (a later
  one sees the earlier ones' result), then every `limit`. So **no limit is exceeded after the
  stage**, wherever it sits in the list, and a limit wins over IK: a limited chain may not reach
  its target.
- **What it writes.** Only the `rotation` of the bones the constraints name (starting from the
  rest rotation when the pose did not name it). Translation, scale, attachments and draw order
  pass through.
- **Two-bone IK.** The first segment runs from the parent's origin to the child's origin:
  `l1 = |child.translation|`, which need not lie on the parent's +x axis. The second is
  `l2 = child.length`. `parent.length` is not used. A target between `|l1 - l2|` and `l1 + l2`
  from the chain root is reached **within 1e-6 world units**. A farther target gives a straight
  chain pointing at it; a nearer one gives a fully folded chain pointing toward it. `bend: 1`
  puts the middle joint on the left of the line from the root to the target (counter-clockwise
  from it), `bend: -1` on the right.
- **Mix.** `mix: 0` leaves the incoming rotations exactly as they were; `mix: 1` writes the solved
  rotations exactly; in between, each rotation moves along the shorter arc (`lerpAngle`), so an
  IK effector does not travel in a straight line to the target.
- **Limits are hard**: no mix. The result is the rotation, modulo a full turn, that lies in
  `[min, max]`; a rotation outside the range moves to the nearer bound by angular distance.
- **Degenerate input** never throws or yields `NaN`: zero-length segments, a target on the chain
  root (the direction is then arbitrary but repeatable), an aim target within 1e-9 of the bone's
  origin (the bone keeps its rotation), a zero scale above the bone (the constraint is skipped).
- **Limitations.** IK assumes the parent and child bones have scale (1, 1) in the pose, and aim
  a positive x scale; non-uniform or negative scale there gives wrong angles. Scale on the bones
  above them is handled. Targets are fixed points: no bone or anchor targets, and clips cannot
  key a mix.

## Meshes and skinning

A mesh is its own plain data, bound to one rig attachment. Rig data is unchanged.

```ts
{
  schemaVersion: 1,
  attachment: 'limb-skin',
  vertices: [
    // Rig space at the rig's rest pose (world units, y-up): the rest pose is the bind pose.
    { position: { x: 0, y: 110 }, uv: { x: 0.5, y: 0 },
      weights: [{ bone: 'upper', weight: 0.5 }, { bone: 'lower', weight: 0.5 }] },
    ...
  ],
  triangles: [[0, 1, 2], ...],  // vertex indices
}
```

`loadMesh(rig, data)` rejects, naming the vertex, triangle, bone or attachment: an unknown
`schemaVersion`; a missing or mistyped field; an attachment the rig does not have; a weight
naming a bone the rig does not have, or one whose rest world transform is not invertible (a zero
rest scale on it or above it); a bone named twice in one vertex; more than `MAX_INFLUENCES` (4)
weights; a weight `<= 0`; weights whose sum is more than `WEIGHT_TOLERANCE` (`1e-6`) from 1; a
vertex with no weights; a UV outside [0, 1]; a triangle index that is not an integer vertex index;
a triangle repeating an index; fewer than 3 vertices; no triangles. It precomputes, per weight,
the vertex in the bone's rest space (`inverse(boneWorld(rest)) · v`).

`skin(mesh, evaluate(rig, pose).bones)` is linear blend skinning: each vertex is
`Σ weight · boneWorld(pose) · inverse(boneWorld(rest)) · v`, in rig space (world units, y-up). At
the rest pose every vertex is at its authored position. It is pure and throws for bones of another
rig. `@mortal-doctrine/skeleton-renderer` draws the result.

## Usage

```ts
import {
  blendStage,
  constraintStage,
  loadClip,
  loadConstraints,
  orderSlots,
  runPipeline,
  sample,
} from '@mortal-doctrine/animation';
import { MANNEQUIN_REACH, RAISE_STAFF, WALK_CYCLE } from '@mortal-doctrine/animation/testing';
import { evaluate, loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';

const rig = loadRig(MANNEQUIN_RIG);
const walk = loadClip(WALK_CYCLE);
const raise = loadClip(RAISE_STAFF);

const reach = constraintStage(rig, loadConstraints(MANNEQUIN_REACH));

const pose = runPipeline(rig, sample(walk, 16.5), [blendStage(sample(raise, 20), 0.5), reach]);
const { bones, slots } = evaluate(rig, pose);
orderSlots(slots, pose.drawOrder).map((slot) => slot.id); // ['held-right', 'body', 'face']
```

## Integration

- **Consumes** `Rig`, `Pose` and `evaluate` from `@mortal-doctrine/rig` (unchanged).
- **Consumers today:** the Studio Animation Lab (`/labs/animation`) and Pose Constraints Lab
  (`/labs/pose-constraints`).
- **Consumers of meshes:** `@mortal-doctrine/skeleton-renderer` and the Skeleton Lab (`Mesh limb`).
- **Later:** M1.10 draws `orderSlots(...)` output with Pixi.

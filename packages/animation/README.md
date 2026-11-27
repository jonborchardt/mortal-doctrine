# @mortal-doctrine/animation

**Layer:** `animation` · **May depend on:** `math`, `rig`, `zod`.

Plays declarative keyframed clips on rigs: validates clip data, samples a clip at a time into a
pose for `@mortal-doctrine/rig`, blends two poses by a weight, and runs an ordered list of pose
stages. Pure and headless: no DOM, Pixi, React or Node APIs. Nothing here knows a bone name.

**Non-goals:** IK and constraints (M1.09), skinning (M1.16), Pixi drawing (M1.10), state machines,
clip queues, additive layers, masks, named easing presets, a clip file format on disk, validating
a clip against a rig at load time, animation-driven gameplay events.

**Animation never decides gameplay timing** (move frame data does), and these results are float
math: never feed them into simulation state.

## API

| Export                                   | Purpose                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `clipDataSchema`, `ClipData`             | Zod schema and authored type of a clip (degrees), `schemaVersion: 1`                           |
| `CLIP_SCHEMA_VERSION`                    | The supported `schemaVersion` (`1`)                                                            |
| `loadClip(data)`                         | Validates `ClipData` and returns a runtime `Clip` (radians); throws listing problems           |
| `key(frame, value, interpolation?)`      | Authoring helper: one key                                                                      |
| `defineClip(id, duration, content)`      | Authoring helper: `ClipData` with the current `schemaVersion`; `loop` defaults off             |
| `sample(clip, time)`                     | The pose at `time` (frames at 60 Hz, fractions allowed)                                        |
| `blend(rig, a, b, weight)`               | Pose `a` blended toward pose `b`                                                               |
| `PoseStage`, `runPipeline(rig, pose, s)` | A stage is `(rig, pose) => pose`; the pipeline applies stages in list order                    |
| `blendStage(other, weight)`              | The blend layer as a stage                                                                     |
| `orderSlots(slots, drawOrder)`           | Applies a pose's draw order to `evaluate(...).slots`                                           |
| `AnimatedPose`                           | Rig `Pose` plus optional `drawOrder` (slot ids, back to front)                                 |
| `Clip`, `Key`, `Interpolation`           | Runtime types (radians)                                                                        |
| `@mortal-doctrine/animation/testing`     | `WALK_CYCLE`, `RAISE_STAFF` (mannequin), `WING_FLAP` (non-humanoid), `INVALID_CLIPS`, `SMOOTH` |

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

A stage is a pure `(rig, pose) => pose`. The one stage shipped here is `blendStage`. A constraint
stage (M1.09) goes **after blend stages and before `evaluate`**.

## Usage

```ts
import { blendStage, loadClip, orderSlots, runPipeline, sample } from '@mortal-doctrine/animation';
import { RAISE_STAFF, WALK_CYCLE } from '@mortal-doctrine/animation/testing';
import { evaluate, loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';

const rig = loadRig(MANNEQUIN_RIG);
const walk = loadClip(WALK_CYCLE);
const raise = loadClip(RAISE_STAFF);

const pose = runPipeline(rig, sample(walk, 16.5), [blendStage(sample(raise, 20), 0.5)]);
const { bones, slots } = evaluate(rig, pose);
orderSlots(slots, pose.drawOrder).map((slot) => slot.id); // ['held-right', 'body', 'face']
```

## Integration

- **Consumes** `Rig`, `Pose` and `evaluate` from `@mortal-doctrine/rig` (unchanged).
- **Consumers today:** the Studio Animation Lab (`/labs/animation`).
- **Later:** M1.09 adds a constraint stage; M1.10 draws `orderSlots(...)` output with Pixi.

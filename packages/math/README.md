# @mortal-doctrine/math

**Layer:** `foundation` · **May depend on:** nothing (no runtime dependencies).

The float math the animation layer needs: 2D points, 2D affine transforms, the angle convention
and interpolation. Pure functions over plain readonly objects; nothing is mutated, nothing is a
class.

**Admission rule:** an export needs a named consumer in rig evaluation (M1.06, #187) or animation
evaluation (M1.08, #189). Later tickets add what they need when they need it.

**Non-goals:** integer gameplay math (that is `@mortal-doctrine/sim-core`), physics, transform
decomposition, bounds, shear, `Vec2` arithmetic, easing curves, Zod schemas for these values.
Presentation code may use Pixi's own math instead.

**Never feed these results into simulation state.** `Math.sin` and `Math.cos` are not
bit-identical across JS engines, so float results are for animation and presentation only.

## API

| Export                                           | Purpose                                                                | Consumer                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Vec2`                                           | `{ x, y }` point or offset                                             | #187: bone translation and scale, anchor positions. #189: translation and scale channel values              |
| `Transform`                                      | `{ a, b, c, d, tx, ty }`: `x' = a·x + c·y + tx`, `y' = b·x + d·y + ty` | #187: local and world bone transforms                                                                       |
| `IDENTITY`                                       | The identity transform (frozen)                                        | #187: the parent transform of a root bone                                                                   |
| `transformFromTrs(translation, rotation, scale)` | Builds scale, then rotation (radians), then translation                | #187: a bone's local transform from its translation / rotation / scale pose                                 |
| `compose(parent, child)`                         | Child first, then parent                                               | #187: `world = compose(parentWorld, local)` down the hierarchy                                              |
| `invert(t)`                                      | The inverse, or `null` when there is none                              | #187: world-to-local conversion, e.g. expressing a world-space anchor or attachment point in a bone's space |
| `apply(t, point)`                                | Transforms a point                                                     | #187: world positions of anchors and bone tips                                                              |
| `degToRad(degrees)`                              | Authored degrees to runtime radians                                    | #187 and #189: content loaders ("convert once in the loader")                                               |
| `radToDeg(radians)`                              | Runtime radians to degrees                                             | #187 and #189: lab read-outs of evaluated rotations in authored units                                       |
| `lerp(a, b, t)`                                  | Scalar linear interpolation                                            | #189: scalar channels between keyframes                                                                     |
| `lerpVec2(a, b, t)`                              | Component-wise `lerp`                                                  | #189: translation and scale channels, pose blending                                                         |
| `lerpAngle(a, b, t)`                             | Interpolation along the shorter arc (radians)                          | #189: rotation channels and pose blending                                                                   |

## Conventions

- **Axes and angles** (`docs/content-conventions.md`): +x right, +y **up**. Angles are radians at
  runtime and degrees in authored content; positive is **counter-clockwise**, so a rotation of
  +90° maps `(1, 0)` to `(0, 1)`. Conversion to screen space (y down) is presentation's job.
- **Build order:** `transformFromTrs` scales, then rotates, then translates.
- **Composition order:** `compose(parent, child)` applies the child first:
  `apply(compose(A, B), p)` equals `apply(A, apply(B, p))`.
- **Epsilon:** float identities hold within a relative error of `1e-9` (absolute difference
  divided by the largest expected magnitude, at least 1) for translations and points within
  ±1000 per axis, scale magnitudes in [0.1, 10] of either sign, and any rotation. That covers
  `compose(T, invert(T))` = identity (both sides), `apply(invert(T), apply(T, p))` = `p` and
  associativity; measured worst case is below `1e-12`. `compose(IDENTITY, T)` and
  `compose(T, IDENTITY)` equal `T` exactly.
- **Singular transforms:** `invert` returns `null` when the determinant is zero (a zero scale on
  either axis) or so small that its reciprocal is not finite. It never throws for finite input
  and never returns `NaN` or `Infinity`. There is no "nearly singular" threshold: any transform
  with a finite reciprocal determinant is inverted. Mirroring (negative) scales invert normally.
- **`lerp` endpoints:** `lerp` is `a·(1 − t) + b·t`, which returns exactly `a` at `t = 0` and
  exactly `b` at `t = 1` for finite inputs. `t` is not clamped.
- **`lerpAngle`:** the path never sweeps more than half a turn, whatever range the inputs are in.
  It returns exactly `a` at `t = 0`; at `t = 1` the result is equivalent to `b` modulo a full
  turn, not necessarily `b` itself, and results are not normalised to any range. When the angles
  are exactly opposite (wrapped difference of exactly π) the path is counter-clockwise. It cannot
  express an authored spin of more than 180° between two keys; use `lerp` for that.

## Usage

```ts
import {
  apply,
  compose,
  degToRad,
  IDENTITY,
  lerpAngle,
  transformFromTrs,
} from '@mortal-doctrine/math';

// A forearm 40 units along an upper arm that is raised 90° at the shoulder.
const upperArm = transformFromTrs({ x: 0, y: 100 }, degToRad(90), { x: 1, y: 1 });
const forearm = transformFromTrs({ x: 40, y: 0 }, degToRad(-30), { x: 1, y: 1 });

const upperArmWorld = compose(IDENTITY, upperArm);
const forearmWorld = compose(upperArmWorld, forearm);
apply(forearmWorld, { x: 0, y: 0 }); // the elbow, about { x: 0, y: 140 }

lerpAngle(degToRad(170), degToRad(-170), 0.5); // ±180°, not 0°
```

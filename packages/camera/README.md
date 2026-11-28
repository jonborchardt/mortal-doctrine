# @mortal-doctrine/camera

**Layer:** `presentation` · **May depend on:** `renderer` (the `View` type only), `simulation`
(read-only state and event types), `movement` (`widestPushboxWidth`), `sim-core`
(`SUBUNITS_PER_UNIT`).

Turns simulation snapshots and events into the renderer's `View`: it frames both fighters
smoothly between zoom limits, zooms out to keep a jumping fighter in frame, never shows world x outside the arena's visual bounds, and adds an
event-driven screen shake. It reads snapshots and events and writes nothing: gameplay cannot
observe it. It uses no Pixi objects, DOM, clock or `Math.random`, so it runs in Node.

**Non-goals:** vertical tracking (the ground line never moves; a jump zooms out instead),
rotation, cinematic or super cameras, sub-tick interpolation, parallax and arena art (M1.12),
effects (M1.13), gameplay separation limits (`movement`), wiring into `apps/game`. Visual bounds
are configuration: an arena package supplies them later.

## API

| Export                                | Meaning                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createCamera(config)`                | A camera at rest. Throws `Invalid camera config: <field>: …` for an invalid configuration.                   |
| `camera.update(state, events?)`       | Advances to `state.frame` and returns `{ view, steady, target, shake }`. Never mutates its arguments.        |
| `output.view`                         | The `View` for `ArenaRenderer.setView`: `steady` plus shake, clamped to the bounds.                          |
| `output.steady`                       | The smoothed view before shake.                                                                              |
| `output.target`                       | `{ left, right }` in sub-units: the visible span the camera is converging to.                                |
| `output.shake`                        | `{ x, y }` in logical pixels, before the bounds clamp; `{ 0, 0 }` at rest.                                   |
| `visibleSpan(view, viewportWidth)`    | The world span `{ left, right }` (sub-units) a view shows.                                                   |
| `FIXTURE_CAMERA_CONFIG` (`./testing`) | Placeholder configuration for tests and the Camera Lab: 960×540, bounds −4000…100000, `land`/`wall-contact`. |

## Configuration

World quantities are simulation sub-units (100 per world unit); screen quantities are logical
pixels.

| Field                                 | Meaning                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `viewport: { width, height }`         | The renderer's logical viewport.                                                          |
| `bounds: { left, right }`             | Visual bounds. Make them at least as wide as the gameplay arena, or a fighter can be cut. |
| `minVisibleWidth` / `maxVisibleWidth` | Zoom limits as visible world width (min = closest zoom).                                  |
| `margin`                              | Space kept between each outer pushbox edge and the frame edge, zoom permitting.           |
| `headroom`                            | Height above every fighter's `y` (its feet) kept below the viewport top; `>= 0`.          |
| `groundMargin`                        | Pixels between the ground line and the viewport bottom, the same at every zoom.           |
| `smoothing`                           | Fraction of the remaining distance covered per simulation frame, in (0, 1]; 1 = none.     |
| `shake`                               | `{ [eventType]: { amplitude, frames } }`: pixels at the first frame, frames until zero.   |

## Rules

**Framing.** The target visible width is the fighters' span plus `2 × margin`, or the headroom
width if that is wider, limited to `[minVisibleWidth, maxVisibleWidth]`; the target centre is the
middle of the span. The span uses each fighter's widest pushbox, so crouching and jumping do not
change it. Centre and width move toward the target by `smoothing` per frame and come to rest
exactly on it. Smoothing may lag the margin but never a fighter: the smoothed frame is widened or
shifted to contain both pushboxes and the headroom on every frame (unless the bounds or
`maxVisibleWidth` make that impossible).

**Headroom.** The camera cannot see rigs, so the height to keep in frame is configuration. The
headroom width is the visible width at which the point `headroom` above the highest fighter's
`y` is exactly at the viewport top:
`(max(y) + headroom) × viewport.width / (viewport.height − groundMargin)`. The view only zooms
out for it: the ground line stays `groundMargin` above the viewport bottom at every zoom. A
`headroom` that fits at `minVisibleWidth` leaves the framing of grounded fighters unchanged.

**Bounds win.** The visible width is never wider than the bounds, even below `minVisibleWidth`,
and the final view, shake included, is clamped so the visible span stays inside them. Bounds are
horizontal only and win over the headroom: when the headroom width exceeds them or
`maxVisibleWidth`, a jumper can leave the top of the frame. Vertical shake is not limited.

**Frame advance.** The camera advances by `state.frame` only, never by wall-clock time or display
frames. Comparing a snapshot's frame with the last one it saw:

- **same frame:** returns the previous output; the events are ignored (already consumed);
- **1 to 15 frames ahead:** that many smoothing steps toward the new target; a shake's age follows
  the frame number;
- **backwards, or more than 15 ahead** (reset, restore, seek): snaps to the target and clears
  every shake. The first snapshot snaps too.

So equal snapshot and event sequences give equal views. Feeding only the latest snapshot after
several ticks is supported, with all of those ticks' events; it equals per-tick feeding only when
the fighters did not move in between, because the skipped snapshots are not seen.

**Shake.** An event whose `type` has a `shake` entry starts a shake on the snapshot after its
tick. Only events of the ticks just run count (`event.frame` from the last seen frame up to, not
including, `state.frame`), so re-fed or stale events never restart one. The offset has magnitude
`amplitude × (1 − age / frames)` in a direction that is a fixed function of the event's frame and
its age, and is exactly zero from `frames` on. When several shakes overlap, the strongest one
applies. Shake moves the view only; scale is unchanged. A restore followed by re-simulation
re-triggers the shakes of the replayed ticks, as a replay of them would look.

## Driving the renderer

Call `setView` before `render`, with the snapshot about to be drawn and every event since the
previous update:

```ts
import { createCamera } from '@mortal-doctrine/camera';

const camera = createCamera(config); // viewport = the renderer's width and height
renderer.onFrame((elapsedMs) => {
  const { events } = runner.advance(elapsedMs, inputs);
  renderer.setView(camera.update(runner.state, events).view);
  renderer.render(runner.state, { events });
});
```

Call `setView` before `render` in the same frame callback, as above: a view set after `render`
trails the picture by one display frame. Hosts own their renderer and frame callback, as the
Camera Lab and `match-view` do. The camera holds no resources: there is nothing to dispose.

## Tests

`pnpm --filter @mortal-doctrine/camera test` (Vitest, Node): framing tables, the movement
scenarios and walk cycle frame by frame, headroom during jumps (zoom-out, return to rest, limits,
seek), bounds clamp cases, smoothing and seek, determinism and shake decay. The Camera Lab (`/labs/camera`, `e2e/studio-camera.spec.ts`) drives the production
camera and renderer.

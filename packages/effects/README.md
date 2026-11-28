# @mortal-doctrine/effects

**Layer:** `presentation` · **May depend on:** `renderer` (`Renderable`, `RenderFrame`, `View`,
`worldToScreen`), `simulation` (read-only state and event types), `pixi.js`, `zod`.

Spawns presentation effects from simulation events, safely under rewinds, replays and restores: a
data-defined, Zod-validated effect registry, an event-type → effect mapping, and a renderable for
the renderer's `effects` layer that draws geometric placeholder sprites and particle bursts and
expires them on display time. It reads snapshots and events and writes nothing: gameplay cannot
observe it. It never reads a clock or `Math.random`.

**Non-goals:** camera shake (`camera`), audio (`audio`), textured or art assets, manifest loading,
character content, pooling, blend modes, screen-space or HUD effects, matching on event fields
other than `type`, rollback, wiring into `apps/game` (M1.18).

## API

| Export                                                                             | Meaning                                                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `parseEffectDefinitions(json)`                                                     | Validates `EffectDefinition[]`; rejects malformed or duplicate ids and non-positive lifetimes, sizes and counts.            |
| `parseEffectMapping(json, definitions)`                                            | Validates `{ [eventType]: { effect, offset?: { x, y } } }`; rejects an `effect` missing from `definitions`.                 |
| `createEffectsRenderable({ definitions, mapping, layer? })`                        | The renderable (default layer `effects`). Validates both inputs and throws naming the field.                                |
| `effects.update(frame)`                                                            | Called by the renderer: spawns effects for new mapped events and places every effect through `frame.view`.                  |
| `effects.advance(elapsedMs)`                                                       | Ages every effect by host display time; an effect whose age reaches `lifetimeMs` is destroyed.                              |
| `effects.clear()`                                                                  | Destroys every effect and forgets every spawned event, for a host-driven restore or seek.                                   |
| `effects.active`                                                                   | Diagnostics: `{ id, key, ageMs, lifetimeMs }` per active effect, oldest first.                                              |
| `effects.destroy()`                                                                | Destroys every effect's display objects and the container. Idempotent; the renderer calls it on unregister.                 |
| `KEY_WINDOW_FRAMES`                                                                | 600: spawned-event keys older than this many frames before the newest snapshot frame are forgotten.                         |
| `CORE_EFFECTS`, `CORE_MAPPING`, `FIXTURE_EVENTS`, `TWIN_LAND_EVENTS` (`./testing`) | Core placeholder effects, a mapping for every current event type, and representative events (including two identical ones). |

Errors name the offending field: `0.id: must be "core/<name>" or "<character>/<name>" in
kebab-case`, `2.id: duplicate effect id "core/land-ring"`, `1.lifetimeMs: …`,
`jump.effect: unknown effect "core/missing"`.

## Definitions

Every definition has `id` (`core/<name>` or `<character>/<name>`, kebab-case, see
`docs/content-conventions.md`), `lifetimeMs` (> 0), `colour` (`0xRRGGBB`) and `size` (> 0, world
units: logical pixels at view scale 1).

- `kind: 'sprite'`: one circle of diameter `size` that grows from half to full size and fades out.
- `kind: 'particles'`: `count` squares of side `size` that move from the origin out to `distance`
  world units and fade out. Each particle's direction is a hash of the event identity and its
  index, so the same event always looks the same.

## Rules

**Position.** Simulation events carry no coordinates. An effect spawns at the event's
`player` fighter position in the snapshot drawn with it, plus the mapping's `offset` (sub-units).
It stays at that world position and follows the view (camera) on every drawn frame. In a
multi-tick batch, an earlier tick's event uses the latest snapshot position.

**Event identity.** As in `@mortal-doctrine/audio`: frame, type and every other field, plus the
occurrence index among identical events in one `update`. A key already spawned never spawns
again, so re-feeding a batch, at the same or a later frame, adds nothing. Two identical events in
one batch spawn two effects.

**Restore and seek.** A snapshot whose `frame` is lower than the last one seen destroys every
active effect and forgets every key, as does `clear()`. Re-simulating the same frames afterwards
shows each effect once. Keys older than `KEY_WINDOW_FRAMES` are forgotten.

**Display time.** `RenderFrame` has no elapsed time, so the host supplies it with `advance`, e.g.
from `renderer.onFrame(elapsedMs)`. Without it effects freeze: pausing is not calling `advance`.

## Usage

```ts
import { createEffectsRenderable, parseEffectDefinitions } from '@mortal-doctrine/effects';

const definitions = parseEffectDefinitions(effectsJson);
const effects = createEffectsRenderable({ definitions, mapping: mappingJson });
renderer.register(effects);
renderer.onFrame((elapsedMs) => {
  const { events } = runner.advance(elapsedMs, inputs);
  effects.advance(elapsedMs);
  renderer.render(runner.state, { events });
});
// on a host-driven restore that keeps the frame number: effects.clear();
```

## Integration points

- **Consumes** `RenderFrame` (`state.fighters[player]`, `events`, `view`) from
  `@mortal-doctrine/renderer`, and display time from the host.
- **Produces** Pixi display objects in its own container, and the `active` diagnostics.
- **Used by** the Studio Effects Lab (`/labs/effects`). Not wired into `apps/game` yet.

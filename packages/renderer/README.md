# @mortal-doctrine/renderer

**Layer:** `presentation` · **May depend on:** `simulation` (read-only state types, runner,
`FIGHTER_WIDTH`), `sim-core` (`SUBUNITS_PER_UNIT`), lower layers, `pixi.js`, `zod`.

Rendering infrastructure that other presentation packages extend without editing it: a PixiJS
application with a configurable logical viewport, a world→screen view (the camera hook), ordered
named layers with a renderable registration API, a manifest texture loader, optional snapshot
interpolation, and `startHostLoop`, the one host loop shared by the game and the Simulation Lab.
The placeholder floor and fighters are ordinary registered renderables.

**Non-goals:** game logic, input devices, React, mutating simulation state. Camera behaviour,
skeletal drawing, effects, arena art and HUD belong to later packages, which register renderables.

## Viewport, view and layers

`createArenaRenderer(host, options?)` options (all optional):

| Option         | Default                                            | Meaning                                                                      |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `width`        | `960`                                              | Logical viewport width = canvas `width` attribute (CSS-scaled to host width) |
| `height`       | `540`                                              | Logical viewport height                                                      |
| `layers`       | `['background', 'fighters', 'effects', 'overlay']` | Layer names, **bottom first**: later layers draw over earlier ones           |
| `placeholders` | `true`                                             | Registers the placeholder floor (`background`) and fighters (`fighters`)     |

A layer name listed twice is one layer, at its first position.

The canvas backing store is always 1× (no device-pixel-ratio handling); the viewport is fixed
at creation (recreate the renderer to change it).

A `View` is `{ scale, originX, originY }`: logical pixels per world unit and the screen position
of the world origin. World space is y-up in simulation sub-units; screen space is y-down in
logical pixels. `defaultView(width, height)` frames 960 world units across the viewport with the
ground line 80 world units above the bottom edge (at 960×540: 1 unit = 1 px, ground line y 460).
`worldToScreen(view, x, y)` maps sub-units to logical pixels. `renderer.setView(view)` is the
camera hook.

## Renderables

```ts
interface Renderable {
  readonly layer: string; // must be one of the renderer's layers, else register throws naming them
  readonly container: Container; // mounted into that layer's Pixi container
  update(frame: RenderFrame): void; // every drawn frame
  destroy(): void; // once: on unregister or renderer.destroy()
}
// RenderFrame = { state, previous, alpha, events, view }
```

`renderer.register(renderable)` returns an idempotent unregister. Registering on a destroyed
renderer (e.g. after an async texture load outlived it) destroys the renderable at once. Layers are plain logical-pixel
containers; a renderable applies `frame.view` itself (position with `worldToScreen`, scale by
`view.scale`), so textures are never flipped. `renderer.render(state, { previous, alpha, events })`
updates every renderable (`render(state)` alone is still valid). `events` are the simulation
events of the ticks run since the previous drawn frame; making their effects idempotent under
restore/seek is the consumer's job.

**Interpolation:** `blendFighterX(previous, current, player, alpha)` lerps a fighter's x and
snaps to the current x unless `previous` is exactly one frame behind (none, reset, seek). The
placeholder fighters use it; nothing else is interpolated.

## Textures

`loadTextureManifest(manifestUrl, { resolution = 2 })` fetches a `schemaVersion: 1` manifest
(`docs/content-conventions.md`), validates it and loads every texture through Pixi `Assets` at
`resolution` (a 192×64 px file is 96×32 logical px at 2×). It resolves to
`{ textures, urls, release }` keyed by texture id. A failed texture rejects with its id and URL,
after releasing the rest.
`parseTextureManifest(json, manifestUrl)` is the Pixi-free validator (relative paths, forward
slashes, no `..` segment, plain or percent-encoded, unknown versions rejected; errors name the field or texture id) returning
id → absolute URL.

Every call returns its own handle, and several handles may hold the same URL: Pixi caches one
texture per URL with no reference count, so the loader counts the live handles per URL. They
share one `Texture` object; `release()` (idempotent) gives one handle back, and a URL is unloaded
from Pixi's asset cache and destroyed when its last handle is released, in any order. Because
there is one texture per URL, loading a URL that a live handle holds at a different `resolution`
rejects, naming the URL and both resolutions. After the last release a new load waits for that
URL's pending unload and uses its own `resolution`.

## Host loop

`startHostLoop(host, { inputs, onFrame?, renderer?, runner?, interpolate? })` owns a renderer,
a `SimulationRunner` and the display-frame subscription. Each display frame it advances the
runner (calling `inputs` once per tick), renders (with `previous` and `runner.alpha` when
`interpolate` is on and the runner is not paused; paused frames draw the current snapshot), then calls `onFrame({ elapsedMs, ticks, events, simMs, state })`. The
handle exposes `ready`, `runner`, `renderer` (undefined until ready), a writable `interpolate`,
`stepOnce()` (its events also reach renderables on the next drawn frame) and `destroy()`, which
is safe before `ready` resolves (React StrictMode) and when repeated.

```ts
import { startHostLoop } from '@mortal-doctrine/renderer';

const loop = startHostLoop(hostElement, {
  inputs: () => [p1.sample(), p2.sample()],
  renderer: { width: 640, height: 360 },
  onFrame: ({ state }) => (frameLabel.textContent = String(state.frame)),
});
await loop.ready;
const unregister = loop.renderer?.register(myRenderable); // e.g. layer 'effects'
// teardown:
loop.destroy(); // destroys every registered renderable, the Pixi app and the canvas
```

Other exports: `ArenaRenderer.onFrame(cb)` (display-frame callback, returns unsubscribe), `fps`,
`frameCpuMs` (CPU ms of the previous frame: callbacks + scene + draw submission, no GPU time),
`destroy()`.

## Tests

`pnpm --filter @mortal-doctrine/renderer test` (Vitest, Node) covers the view transform, blend
and manifest parser, and (`tests/texture-sharing.test.ts`, with `fetch`, `document` and Pixi
`Assets` stubbed) the counted texture handles: unload once with the last release, the
same-resolution rule and failed loads. Tests import only the public entry `../src/index.ts`: PixiJS v8 loads in
Node as long as no `Application` is created, so no `./testing` entry is needed. Drawing, layers,
registration, texture loading and teardown need WebGL and are covered by Playwright (`e2e/`)
through the game and the Simulation Lab (its fixture renderable).

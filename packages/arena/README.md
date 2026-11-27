# @mortal-doctrine/arena

**Layer:** `presentation` · **May depend on:** `renderer` (`Renderable`, `View`,
`LoadedTextures`), `sim-core` (`SUBUNITS_PER_UNIT`, `int32Schema`), `pixi.js`, `zod`.

Arena presentation: a versioned schema for layered arena scenes and a renderable that draws the
layers with horizontal parallax from the `View` a camera produces. It reads the view and writes
nothing; gameplay cannot observe it. The schema and the parallax rule use no Pixi objects or
browser APIs.

**Non-goals:** gameplay bounds (`movement` owns them) and checking visual geometry against them,
stage hazards, production arenas or art, foreground layers (in front of fighters), vertical
parallax, tiling, image scaling, tint, animated layers, migrations, camera behaviour (`camera`),
wiring into `apps/game`.

## API

| Export                                                              | Meaning                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `parseArena(json)`                                                  | Validates arena data and returns an `Arena`. Throws `Unsupported arena schemaVersion <found>; supported: 1` or `Invalid arena: <path>: …`. |
| `Arena`                                                             | The validated data type.                                                                                                                   |
| `parallaxToScreen(view, viewportWidth, arena, parallax, x, y)`      | Screen position (logical px) of an authored point of a layer; `arena` needs only `groundLine` and `visualBounds`.                          |
| `createArenaRenderable({ arena, textures, viewportWidth, layer? })` | A `Renderable` for `ArenaRenderer.register`. `layer` is the renderer layer, default `background`.                                          |
| `renderable.setLayerVisible(layerId, visible)`                      | Shows or hides one arena layer. Throws naming the arena's layers for an unknown id.                                                        |
| `PLACEHOLDER_ARENA` (`./testing`)                                   | Geometric placeholder: four layers (parallax 0, 0.25, 0.5, 1), ground line 10000, visual bounds −4000…100000.                              |

## Schema (`schemaVersion: 1`)

Unknown keys are rejected at every level. Coordinates are integer world sub-units (int32), +x
right, +y up (`docs/content-conventions.md`).

| Field                       | Type                | Rule                                                                                                                      |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`             | `1`                 | Any other value is rejected, naming the found and supported versions.                                                     |
| `id`                        | string              | Kebab-case.                                                                                                               |
| `groundLine`                | integer             | The authored y that is the ground: drawn at gameplay y = 0 (`view.originY`).                                              |
| `visualBounds.left/right`   | integer             | `right > left`. The world x the camera may show; its centre is the parallax reference. Pass it to the camera as `bounds`. |
| `layers`                    | array, at least one | Back to front. Layer ids are unique.                                                                                      |
| `layers[].id`               | string              | Kebab-case.                                                                                                               |
| `layers[].parallax`         | number              | In [0, 1]: 1 moves with the gameplay plane, 0 is fixed on screen.                                                         |
| `layers[].images`           | array               | Drawn in order; may be empty.                                                                                             |
| `layers[].images[].texture` | string              | Non-empty texture id of the arena's asset manifest.                                                                       |
| `layers[].images[].x`, `y`  | integer             | The image's **bottom-left corner** (`y = groundLine` rests it on the ground).                                             |

## Parallax and placement rule

With `W` = viewport width (logical px), `s = view.scale`, camera centre
`c = (W/2 − view.originX) / s × SUBUNITS_PER_UNIT` and reference
`r = (visualBounds.left + visualBounds.right) / 2`, an authored point `(p, y)` of a layer with
factor `f` is drawn at

```
screen x = W/2 + (p − r − f × (c − r)) × s / SUBUNITS_PER_UNIT
screen y = view.originY − (y − groundLine) × s / SUBUNITS_PER_UNIT
```

- At `c = r` every layer sits at its authored world x. `f = 1` equals `worldToScreen`; `f = 0`
  ignores the camera's x. When the camera centre moves by `d`, a layer moves `f` times as far on
  screen as the ground does.
- Parallax is horizontal only: y never depends on `f`, and every layer scales with `view.scale`.
- An image's size is its texture's logical size, 1 logical px = 1 world unit at `view.scale` 1:
  a 192×64 px `@2x` file loaded at resolution 2 covers 9600×3200 sub-units. Images are scaled by
  `view.scale` only, never flipped, stretched or tiled.
- `viewportWidth` must be the renderer's `width` and the camera's `viewport.width`; `View`
  carries no viewport size, and a different value gives wrong parallax.

## Renderable

All arena layers are mounted, in data order, in one renderer layer. The renderable **owns** the
`LoadedTextures` it is given: it releases them on `destroy` (called by unregister or
`renderer.destroy()`), or at once if the factory throws because an image names a texture id that
is not loaded (`Arena "<id>": layer "<layer>" has no texture "<texture>"`). `destroy` is
idempotent. One live owner per manifest URL (renderer rule): unregister before loading the same
manifest again.

```ts
import { createArenaRenderable, parseArena } from '@mortal-doctrine/arena';
import { createCamera } from '@mortal-doctrine/camera';
import { createArenaRenderer, loadTextureManifest } from '@mortal-doctrine/renderer';

const arena = parseArena(arenaJson);
const viewport = { width: 960, height: 540 };
const renderer = await createArenaRenderer(host, { ...viewport, placeholders: false });
const camera = createCamera({ ...cameraConfig, viewport, bounds: arena.visualBounds });
const renderable = createArenaRenderable({
  arena,
  textures: await loadTextureManifest(manifestUrl),
  viewportWidth: viewport.width,
});
const unregister = renderer.register(renderable);
// every display frame:
renderer.setView(camera.update(state, events).view);
renderer.render(state);
// teardown:
unregister(); // destroys the sprites and releases the textures
```

## Tests and lab

`pnpm --filter @mortal-doctrine/arena test` (Vitest, Node) covers the parallax rule against
hand-computed values, the ground line, schema rejection and the renderable (order, placement,
visibility, texture ownership). Drawing is covered by Playwright through the Arena Lab
(`/labs/arena`, `e2e/studio-arena.spec.ts`), which draws `PLACEHOLDER_ARENA` with the textures
in `apps/studio/public/fixtures/arena/`.

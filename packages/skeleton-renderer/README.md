# @mortal-doctrine/skeleton-renderer

**Layer:** `presentation` · **May depend on:** `renderer` (`Renderable`, `View`,
`LoadedTextures`), `rig`, `animation`, `math`, `pixi.js`.

Draws an evaluated rig with PixiJS sprites through the renderer's extension API: a `Renderable`
that takes a rig once and a pose, facing and character origin per frame. It never creates a Pixi
`Application` or a renderer; mount it with `ArenaRenderer.register`.

**Non-goals:** mesh deformation (M1.16), animation playback or blending (callers supply the
pose), per-attachment offsets, rotation or tint, production art, camera, interpolation.

## API

| Export                                               | Meaning                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createSkeletonRenderable({ rig, layer, textures })` | The renderable. Throws, naming the attachment, when one has no texture       |
| `SkeletonRenderable.setPose(pose, facing, origin)`   | Stores what the next `update` draws. `origin` is in world sub-units          |
| `slotDisplayTransform(slot, facing, origin, view)`   | Pixi-free: evaluated slot transform → y-down screen affine (`a b c d tx ty`) |
| `Facing`                                             | `1` (as authored, facing right) or `-1` (mirrored)                           |

## Behaviour

- **Per frame:** call `setPose` (it only stores its inputs), then `ArenaRenderer.render`, which
  calls `update`. `update` does everything from the latest inputs and `frame.view`: `evaluate`,
  `orderSlots`, textures, visibility, child order and transforms. One `setPose` + one `update`
  fully applies a pose, attachment, draw-order, facing or origin change. Before the first
  `setPose`, `update` draws the rest pose at facing 1, origin (0, 0).
- **Sprites:** one per slot that owns at least one attachment, labelled with the slot id, in the
  pose's draw order (back to front). A slot whose active attachment is `null` is hidden.
- **Placement:** texture id = attachment id (`docs/content-conventions.md`). An image's
  left-centre sits on the slot origin, image +x runs along the bone's +x, and 1 logical px is
  1 world unit at `view.scale` 1. Facing -1 mirrors about the character origin (negative
  determinant); at facing 1 textures are never flipped.
- **Ownership:** the renderable owns `textures` (a `LoadedTextures` from `loadTextureManifest`)
  from the factory call on. `destroy()` is synchronous and idempotent: it destroys the container
  and its sprites, then calls `textures.release()` once without awaiting it; a rejected release
  is reported with `console.error`. If the factory throws, it has already released the set.
  The renderer caches one texture per URL, so give each manifest a single live owner: destroy
  (unregister) the old renderable before loading the manifest again. `loadTextureManifest`
  waits for the pending release itself.
- `update` throws what `evaluate` and `orderSlots` throw for a pose that names an unknown bone,
  slot or attachment.

## Usage

```ts
import { createArenaRenderer, loadTextureManifest } from '@mortal-doctrine/renderer';
import { createSkeletonRenderable } from '@mortal-doctrine/skeleton-renderer';

const renderer = await createArenaRenderer(host, { placeholders: false });
const skeleton = createSkeletonRenderable({
  rig,
  layer: 'fighters',
  textures: await loadTextureManifest('/assets/manifest.json'),
});
const unregister = renderer.register(skeleton);
renderer.onFrame(() => {
  skeleton.setPose(pose, facing, { x: fighter.x, y: 0 });
  renderer.render(state);
});
// teardown: destroys the sprites and releases the textures
unregister();
```

## Integration and tests

Consumer today: the Studio Skeleton Lab (`/labs/skeleton`), next to its SVG debug view. The
Animation Lab and the game adopt it in later tickets.

`pnpm --filter @mortal-doctrine/skeleton-renderer test` (Vitest, Node, no `Application`) covers
the transform mapping by hand-computed values, draw order, attachment switches, mirroring and
teardown. Actual drawing needs WebGL and is covered by `e2e/studio-skeleton.spec.ts`.

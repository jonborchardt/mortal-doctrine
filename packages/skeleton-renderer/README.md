# @mortal-doctrine/skeleton-renderer

**Layer:** `presentation` · **May depend on:** `renderer` (`Renderable`, `View`,
`LoadedTextures`), `rig`, `animation`, `math`, `pixi.js`.

Draws an evaluated rig with PixiJS sprites, and skinned mesh attachments as Pixi meshes, through
the renderer's extension API: a `Renderable`
that takes a rig once and a pose, facing and character origin per frame. It never creates a Pixi
`Application` or a renderer; mount it with `ArenaRenderer.register`.

**Non-goals:** GPU skinning, mesh authoring, animation playback or blending (callers supply the
pose), per-attachment offsets, rotation or tint, production art, camera, interpolation.

## API

| Export                                               | Meaning                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createSkeletonRenderable({ rig, layer, textures })` | The renderable. Throws, naming the attachment, when one has no texture       |
| `createSkeletonRenderable({ ..., meshes })`          | Optional `Mesh[]` from `loadMesh` for this rig: those attachments deform     |
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
- **Meshes:** a slot whose attachments have meshes gets a container (labelled with the slot id)
  holding one `MeshSimple` per attachment (labelled with the attachment id), textured with the
  attachment's texture. Only the active attachment's mesh is visible (none for `null`); switching
  toggles visibility and never rebuilds geometry. Each `update` skins the active mesh
  (`skin` from `@mortal-doctrine/animation`) and writes screen coordinates straight into its
  geometry: with `at = worldToScreen(view, origin.x, origin.y)`, a rig-space vertex `v` lands at
  `(at.x + view.scale * facing * v.x, at.y - view.scale * v.y)`. Mesh objects keep an identity
  transform. Facing -1 flips triangle winding; Pixi meshes are not culled, so they still draw.
  The factory throws (after releasing the textures) for a mesh of another rig, two meshes for one
  attachment, or a slot mixing mesh and sprite attachments.
- **Placement:** texture id = attachment id (`docs/content-conventions.md`). An image's
  left-centre sits on the slot origin, image +x runs along the bone's +x, and 1 logical px is
  1 world unit at `view.scale` 1. Facing -1 mirrors about the character origin (negative
  determinant); at facing 1 textures are never flipped.
- **Ownership:** the renderable owns `textures` (a `LoadedTextures` from `loadTextureManifest`)
  from the factory call on. `destroy()` is synchronous and idempotent: it destroys the container,
  its sprites and meshes, and the mesh geometry (with its buffers), then calls `textures.release()` once without awaiting it; a rejected release
  is reported with `console.error`. If the factory throws, it has already released the set.
  Give each renderable its own handle: `loadTextureManifest` counts the handles on a URL and
  unloads it with the last release, so two renderables can draw from the same manifest (loaded
  once each, at the same resolution) and be destroyed in any order.
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
teardown, and (`tests/mesh.test.ts`) skinned mesh vertices, mesh visibility, teardown and mesh
validation. `e2e/studio-skeleton-mesh.spec.ts` checks the bending limb in the browser. Actual drawing needs WebGL and is covered by `e2e/studio-skeleton.spec.ts`.

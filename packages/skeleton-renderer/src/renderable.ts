import { Container, Matrix, MeshSimple, Sprite, Texture } from 'pixi.js';
import { orderSlots, skin, type AnimatedPose, type Mesh } from '@mortal-doctrine/animation';
import type { Vec2 } from '@mortal-doctrine/math';
import {
  worldToScreen,
  type LoadedTextures,
  type Renderable,
  type RenderFrame,
} from '@mortal-doctrine/renderer';
import { evaluate, type Rig } from '@mortal-doctrine/rig';
import { slotDisplayTransform, type Facing } from './transform';

interface SkeletonRenderableOptions {
  readonly rig: Rig;
  /** The renderer layer to mount in. */
  readonly layer: string;
  /**
   * One texture per rig attachment, keyed by attachment id. Owned by the renderable from this
   * call on: it releases them on `destroy` (or at once if the factory throws).
   */
  readonly textures: LoadedTextures;
  /**
   * Meshes loaded with `loadMesh` for this rig, at most one per attachment. An attachment with a
   * mesh is drawn deformed; a slot's attachments are either all meshes or all sprites.
   */
  readonly meshes?: readonly Mesh[];
}

export interface SkeletonRenderable extends Renderable {
  /**
   * Stores what the next `update` draws: the pose, the facing and the character origin in world
   * sub-units. Until the first call, `update` draws the rest pose at facing 1, origin (0, 0).
   */
  setPose(pose: AnimatedPose, facing: Facing, origin: Vec2): void;
}

/** Problems that make `meshes` unusable with `rig`, if any. */
function meshProblem(rig: Rig, meshes: readonly Mesh[]): string | undefined {
  const seen = new Set<string>();
  for (const mesh of meshes) {
    if (mesh.rig !== rig.id) return `mesh "${mesh.attachment}" is for rig "${mesh.rig}"`;
    if (seen.has(mesh.attachment)) return `two meshes for attachment "${mesh.attachment}"`;
    seen.add(mesh.attachment);
  }
  for (const slot of rig.slots) {
    const owned = rig.attachments.filter((attachment) => attachment.slot === slot.id);
    const meshed = owned.filter(({ id }) => seen.has(id)).length;
    if (meshed > 0 && meshed < owned.length) {
      return `slot "${slot.id}" mixes mesh and sprite attachments`;
    }
  }
  return undefined;
}

/**
 * Draws a rig with one sprite per attachment-bearing slot, or, for a slot whose attachments have
 * meshes, one deformed Pixi mesh per attachment. Mount it with `ArenaRenderer.register`. Throws
 * when an attachment has no texture or the meshes do not fit the rig.
 */
export function createSkeletonRenderable({
  rig,
  layer,
  textures,
  meshes = [],
}: SkeletonRenderableOptions): SkeletonRenderable {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Not awaited: `loadTextureManifest` waits for a pending release of the same URL itself.
    textures.release().catch((cause: unknown) => console.error(cause));
  };

  const missing = rig.attachments.find(({ id }) => !Object.hasOwn(textures.textures, id));
  if (missing) {
    release();
    throw new Error(`Rig "${rig.id}": attachment "${missing.id}" has no texture`);
  }
  const problem = meshProblem(rig, meshes);
  if (problem) {
    release();
    throw new Error(`Rig "${rig.id}": ${problem}`);
  }

  const container = new Container({ label: `skeleton-${rig.id}` });
  // Mesh slots: a container (identity transform) holding one mesh per attachment, whose
  // geometry is in screen coordinates.
  const drawn = new Map<string, { mesh: Mesh; display: MeshSimple }>(
    meshes.map((mesh) => {
      const display = new MeshSimple({
        label: mesh.attachment,
        // Present: every rig attachment has a texture (checked above).
        texture: textures.textures[mesh.attachment] ?? Texture.EMPTY,
        vertices: new Float32Array(mesh.vertices.length * 2),
        uvs: new Float32Array(mesh.vertices.flatMap(({ uv }) => [uv.x, uv.y])),
        indices: new Uint32Array(mesh.triangles.flat()),
      });
      return [mesh.attachment, { mesh, display }];
    }),
  );
  const geometries = [...drawn.values()].map(({ display }) => display.geometry);
  // Image left-centre on the slot origin.
  const children = new Map(
    rig.slots
      .filter((slot) => rig.attachments.some((attachment) => attachment.slot === slot.id))
      .map((slot) => {
        const owned = rig.attachments.filter((attachment) => attachment.slot === slot.id);
        const displays = owned.flatMap(({ id }) => drawn.get(id)?.display ?? []);
        if (displays.length === 0) {
          return [slot.id, new Sprite({ label: slot.id, anchor: { x: 0, y: 0.5 } })];
        }
        const group = new Container({ label: slot.id });
        group.addChild(...displays);
        return [slot.id, group];
      }),
  );
  container.addChild(...children.values());

  let pose: AnimatedPose = {};
  let facing: Facing = 1;
  let origin: Vec2 = { x: 0, y: 0 };
  const matrix = new Matrix();

  return {
    layer,
    container,
    setPose(nextPose, nextFacing, nextOrigin) {
      pose = nextPose;
      facing = nextFacing;
      origin = nextOrigin;
    },
    update({ view }: RenderFrame) {
      const evaluated = evaluate(rig, pose);
      let index = 0;
      for (const slot of orderSlots(evaluated.slots, pose.drawOrder)) {
        const child = children.get(slot.id);
        if (!child) continue;
        // Back to front; untouched when the order did not change.
        if (container.children[index] !== child) container.setChildIndex(child, index);
        index++;
        if (!(child instanceof Sprite)) {
          for (const display of child.children) display.visible = display.label === slot.attachment;
          const active = slot.attachment === null ? undefined : drawn.get(slot.attachment);
          if (!active) continue;
          // Rig space (y-up, world units) to screen, mirrored about the origin by facing.
          const at = worldToScreen(view, origin.x, origin.y);
          const vertices = active.display.vertices;
          skin(active.mesh, evaluated.bones).forEach((v, i) => {
            vertices[2 * i] = at.x + view.scale * facing * v.x;
            vertices[2 * i + 1] = at.y - view.scale * v.y;
          });
          continue;
        }
        const texture = slot.attachment === null ? undefined : textures.textures[slot.attachment];
        child.visible = texture !== undefined;
        if (!texture) continue;
        child.texture = texture;
        const { a, b, c, d, tx, ty } = slotDisplayTransform(slot.transform, facing, origin, view);
        child.setFromMatrix(matrix.set(a, b, c, d, tx, ty));
      }
    },
    destroy() {
      if (released) return;
      container.destroy({ children: true });
      // A mesh does not destroy its geometry.
      for (const geometry of geometries) geometry.destroy(true);
      release();
    },
  };
}

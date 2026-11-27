import { Container, Matrix, Sprite } from 'pixi.js';
import { orderSlots, type AnimatedPose } from '@mortal-doctrine/animation';
import type { Vec2 } from '@mortal-doctrine/math';
import type { LoadedTextures, Renderable, RenderFrame } from '@mortal-doctrine/renderer';
import { evaluate, type Rig } from '@mortal-doctrine/rig';
import { slotDisplayTransform, type Facing } from './transform';

export interface SkeletonRenderableOptions {
  readonly rig: Rig;
  /** The renderer layer to mount in. */
  readonly layer: string;
  /**
   * One texture per rig attachment, keyed by attachment id. Owned by the renderable from this
   * call on: it releases them on `destroy` (or at once if the factory throws).
   */
  readonly textures: LoadedTextures;
}

export interface SkeletonRenderable extends Renderable {
  /**
   * Stores what the next `update` draws: the pose, the facing and the character origin in world
   * sub-units. Until the first call, `update` draws the rest pose at facing 1, origin (0, 0).
   */
  setPose(pose: AnimatedPose, facing: Facing, origin: Vec2): void;
}

/**
 * Draws a rig with one sprite per attachment-bearing slot. Mount it with
 * `ArenaRenderer.register`. Throws, naming the attachment, when one has no texture.
 */
export function createSkeletonRenderable({
  rig,
  layer,
  textures,
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

  const container = new Container({ label: `skeleton-${rig.id}` });
  // Image left-centre on the slot origin.
  const sprites = new Map(
    rig.slots
      .filter((slot) => rig.attachments.some((attachment) => attachment.slot === slot.id))
      .map((slot) => [slot.id, new Sprite({ label: slot.id, anchor: { x: 0, y: 0.5 } })]),
  );
  container.addChild(...sprites.values());

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
      let index = 0;
      for (const slot of orderSlots(evaluate(rig, pose).slots, pose.drawOrder)) {
        const sprite = sprites.get(slot.id);
        if (!sprite) continue;
        // Back to front; untouched when the order did not change.
        if (container.children[index] !== sprite) container.setChildIndex(sprite, index);
        index++;
        const texture = slot.attachment === null ? undefined : textures.textures[slot.attachment];
        sprite.visible = texture !== undefined;
        if (!texture) continue;
        sprite.texture = texture;
        const { a, b, c, d, tx, ty } = slotDisplayTransform(slot.transform, facing, origin, view);
        sprite.setFromMatrix(matrix.set(a, b, c, d, tx, ty));
      }
    },
    destroy() {
      if (released) return;
      container.destroy({ children: true });
      release();
    },
  };
}

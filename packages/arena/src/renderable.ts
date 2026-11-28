import { Container, Sprite } from 'pixi.js';
import type { LoadedTextures, Renderable, RenderFrame } from '@mortal-doctrine/renderer';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import { parallaxToScreen } from './parallax';
import type { Arena } from './schema';

interface ArenaRenderableOptions {
  readonly arena: Arena;
  /**
   * One texture per texture id the arena's images name. Owned by the renderable from this call
   * on: it releases them on `destroy` (or at once if the factory throws).
   */
  readonly textures: LoadedTextures;
  /** Logical viewport width in pixels: the renderer's `width` and the camera's `viewport.width`. */
  readonly viewportWidth: number;
  /** The renderer layer to mount in. Default `background`. */
  readonly layer?: string;
}

export interface ArenaRenderable extends Renderable {
  /** Shows or hides one arena layer. Throws naming the arena's layers for an unknown id. */
  setLayerVisible(layerId: string, visible: boolean): void;
}

/**
 * Draws an arena's layers, back to front in data order, each shifted by its parallax factor for
 * `frame.view`. Mount it with `ArenaRenderer.register`. Throws, naming the layer and texture id,
 * when an image has no texture.
 */
export function createArenaRenderable({
  arena,
  textures,
  viewportWidth,
  layer = 'background',
}: ArenaRenderableOptions): ArenaRenderable {
  // Not awaited: `loadTextureManifest` waits for a pending release of the same URL itself.
  const release = () => {
    textures.release().catch((cause: unknown) => console.error(cause));
  };

  // Resolved before anything is created, so a missing texture leaves nothing behind.
  const resolved = arena.layers.map(({ id, parallax, images }) => ({
    id,
    parallax,
    images: images.map(({ texture: textureId, x, y }) => {
      const texture = textures.textures[textureId];
      if (!Object.hasOwn(textures.textures, textureId) || !texture) {
        release();
        throw new Error(`Arena "${arena.id}": layer "${id}" has no texture "${textureId}"`);
      }
      return { textureId, texture, x, y };
    }),
  }));

  const container = new Container({ label: `arena-${arena.id}` });
  // A layer container sits at the screen position of the layer's authored origin, scaled by the
  // view; its sprites keep their authored offsets in world units (= logical pixels at scale 1).
  const layers = resolved.map(({ id, parallax, images }) => {
    const layerContainer = new Container({ label: id });
    for (const { textureId, texture, x, y } of images) {
      layerContainer.addChild(
        new Sprite({
          label: textureId,
          texture,
          // Bottom-left corner on the authored point.
          anchor: { x: 0, y: 1 },
          x: x / SUBUNITS_PER_UNIT,
          y: -y / SUBUNITS_PER_UNIT,
        }),
      );
    }
    container.addChild(layerContainer);
    return { id, parallax, container: layerContainer };
  });
  let destroyed = false;

  return {
    layer,
    container,
    setLayerVisible(layerId, visible) {
      const target = layers.find(({ id }) => id === layerId);
      if (!target) {
        const known = layers.map(({ id }) => id).join(', ');
        throw new Error(`Arena "${arena.id}" has no layer "${layerId}"; layers are: ${known}`);
      }
      target.container.visible = visible;
    },
    update({ view }: RenderFrame) {
      for (const { parallax, container: layerContainer } of layers) {
        const origin = parallaxToScreen(view, viewportWidth, arena, parallax, 0, 0);
        layerContainer.position.set(origin.x, origin.y);
        layerContainer.scale.set(view.scale);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.destroy({ children: true });
      release();
    },
  };
}

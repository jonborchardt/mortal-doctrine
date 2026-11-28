import { Texture, TextureSource, type Container } from 'pixi.js';
import { worldToScreen, type LoadedTextures, type RenderFrame } from '@mortal-doctrine/renderer';
import { createInitialState } from '@mortal-doctrine/simulation';
import { describe, expect, it, vi } from 'vitest';
import { createArenaRenderable, parallaxToScreen, parseArena, type Arena } from '../src/index';
import { PLACEHOLDER_ARENA } from '../src/testing';

// Viewport 800 px wide; parallax reference r = 40000.
const WIDTH = 800;
const BOUNDS = { left: 0, right: 80_000 };
const FLAT = { groundLine: 0, visualBounds: BOUNDS };
const RAISED = { groundLine: 3000, visualBounds: BOUNDS };
// Camera centre c = (400 - originX) / scale * 100.
const VIEWS = {
  // 2 px per world unit, c = 40000 = r.
  nearCentred: { scale: 2, originX: -400, originY: 500 },
  // c = 50000: the ground moves 10000 sub-units = 200 px.
  nearPanned: { scale: 2, originX: -600, originY: 500 },
  // 0.5 px per world unit with a vertical (shake) offset, c = 40000 = r.
  farCentred: { scale: 0.5, originX: 200, originY: 437.5 },
  // c = 50000: the ground moves 50 px.
  farPanned: { scale: 0.5, originX: 150, originY: 437.5 },
};
const FACTORS = [0, 0.25, 0.5, 1];
// The authored point (46000, 2000): 6000 sub-units right of r.
const X = 46_000;
const Y = 2000;

describe('parallaxToScreen', () => {
  it('gives every factor the factor-1 position when the camera is centred on the bounds', () => {
    for (const f of FACTORS) {
      // 400 + 6000 × 0.02 and 500 − 2000 × 0.02.
      expect(parallaxToScreen(VIEWS.nearCentred, WIDTH, FLAT, f, X, Y)).toEqual({ x: 520, y: 460 });
      // 400 + 6000 × 0.005 and 437.5 − 2000 × 0.005.
      expect(parallaxToScreen(VIEWS.farCentred, WIDTH, FLAT, f, X, Y)).toEqual({
        x: 430,
        y: 427.5,
      });
    }
  });

  it.each([
    // The ground point moves −200 px; a layer point moves f times that: 520 − 200 f.
    ['near', VIEWS.nearPanned, [520, 470, 420, 320], 460],
    // The ground point moves −50 px: 430 − 50 f.
    ['far', VIEWS.farPanned, [430, 417.5, 405, 380], 427.5],
  ] as const)('moves a layer point by its factor at the %s scale', (_, view, xs, y) => {
    FACTORS.forEach((f, index) => {
      expect(parallaxToScreen(view, WIDTH, FLAT, f, X, Y)).toEqual({ x: xs[index], y });
    });
    // Factor 1 is the gameplay plane.
    expect(parallaxToScreen(view, WIDTH, FLAT, 1, X, Y)).toEqual(worldToScreen(view, X, Y));
  });

  it('draws the ground line at view.originY for every view and factor', () => {
    for (const view of Object.values(VIEWS)) {
      for (const f of FACTORS) {
        expect(parallaxToScreen(view, WIDTH, FLAT, f, X, 0).y).toBe(view.originY);
        expect(parallaxToScreen(view, WIDTH, RAISED, f, X, 3000).y).toBe(view.originY);
      }
    }
    // 2000 sub-units above a raised ground line: 500 − 2000 × 0.02.
    expect(parallaxToScreen(VIEWS.nearPanned, WIDTH, RAISED, 0.5, X, 5000).y).toBe(460);
  });
});

describe('parseArena', () => {
  it('accepts the placeholder arena', () => {
    expect(parseArena(structuredClone(PLACEHOLDER_ARENA))).toEqual(PLACEHOLDER_ARENA);
  });

  it('rejects an unsupported schemaVersion naming the found and supported versions', () => {
    expect(() => parseArena({ ...PLACEHOLDER_ARENA, schemaVersion: 2 })).toThrow(
      'Unsupported arena schemaVersion 2; supported: 1',
    );
    expect(() => parseArena({})).toThrow('Unsupported arena schemaVersion undefined; supported: 1');
  });

  const layer = PLACEHOLDER_ARENA.layers[1];
  const withLayer = (change: object) => ({
    ...PLACEHOLDER_ARENA,
    layers: [PLACEHOLDER_ARENA.layers[0], { ...layer, ...change }],
  });
  const withImage = (change: object) =>
    withLayer({ images: [{ texture: 'far-tower', x: 0, y: 0, ...change }] });

  it.each([
    ['an unknown key', { ...PLACEHOLDER_ARENA, hazards: [] }, 'hazards'],
    ['an unknown layer key', withLayer({ tint: 1 }), 'layers.1: '],
    ['a non-kebab-case arena id', { ...PLACEHOLDER_ARENA, id: 'Bad_Id' }, 'id: must be kebab-case'],
    ['a non-kebab-case layer id', withLayer({ id: 'Far' }), 'layers.1.id: must be kebab-case'],
    ['empty layers', { ...PLACEHOLDER_ARENA, layers: [] }, 'layers: '],
    ['a duplicate layer id', withLayer({ id: 'sky' }), 'layers.1.id: duplicate layer id "sky"'],
    ['a parallax factor below 0', withLayer({ parallax: -0.1 }), 'layers.1.parallax: '],
    ['a parallax factor above 1', withLayer({ parallax: 1.01 }), 'layers.1.parallax: '],
    ['a non-finite parallax factor', withLayer({ parallax: Infinity }), 'layers.1.parallax: '],
    ['a NaN parallax factor', withLayer({ parallax: NaN }), 'layers.1.parallax: '],
    ['a non-integer image coordinate', withImage({ x: 0.5 }), 'layers.1.images.0.x: '],
    ['a non-integer ground line', { ...PLACEHOLDER_ARENA, groundLine: 1.5 }, 'groundLine: '],
    [
      'visual bounds with right equal to left',
      { ...PLACEHOLDER_ARENA, visualBounds: { left: 5, right: 5 } },
      'visualBounds.right: must be greater than left',
    ],
    [
      'visual bounds with right below left',
      { ...PLACEHOLDER_ARENA, visualBounds: { left: 5, right: 4 } },
      'visualBounds.right: must be greater than left',
    ],
    ['an empty texture id', withImage({ texture: '' }), 'layers.1.images.0.texture: '],
  ])('rejects %s naming the path', (_, json, message) => {
    expect(() => parseArena(json)).toThrow('Invalid arena: ');
    expect(() => parseArena(json)).toThrow(message);
  });
});

// A 192×64 px file at resolution 2: 96×32 logical px.
const sized = () => new Texture({ source: new TextureSource({ width: 96, height: 32 }) });

function stubTextures(ids: readonly string[], release = vi.fn(() => Promise.resolve())) {
  const textures = Object.fromEntries(ids.map((id) => [id, sized()]));
  const loaded: LoadedTextures = { textures, urls: {}, release };
  return { textures, loaded, release };
}

const ARENA: Arena = {
  schemaVersion: 1,
  id: 'test',
  ...RAISED,
  layers: [
    { id: 'back', parallax: 0.5, images: [{ texture: 'block', x: 46_000, y: 5000 }] },
    { id: 'empty', parallax: 0, images: [] },
    { id: 'front', parallax: 1, images: [{ texture: 'block', x: 46_000, y: 3000 }] },
  ],
};
const FRAME: RenderFrame = {
  state: createInitialState(),
  previous: undefined,
  alpha: 0,
  events: [],
  view: VIEWS.nearPanned,
};

const create = (textures: LoadedTextures) =>
  createArenaRenderable({ arena: ARENA, textures, viewportWidth: WIDTH });
const layerOf = (container: Container, id: string) => {
  const layer = container.children.find((child) => child.label === id);
  if (!layer) throw new Error(`No layer ${id}`);
  return layer;
};
const boundsOf = (container: Container, id: string) => {
  const { x, y, width, height } = layerOf(container, id).getBounds();
  return { x, y, width, height };
};

describe('createArenaRenderable', () => {
  it('mounts in the background layer by default, with the layers in data order', () => {
    const renderable = create(stubTextures(['block']).loaded);
    expect(renderable.layer).toBe('background');
    expect(renderable.container.children.map((child) => child.label)).toEqual([
      'back',
      'empty',
      'front',
    ]);
    expect(
      createArenaRenderable({
        arena: ARENA,
        textures: stubTextures(['block']).loaded,
        viewportWidth: WIDTH,
        layer: 'overlay',
      }).layer,
    ).toBe('overlay');
  });

  it('places an image by its bottom-left corner at its logical size times the view scale', () => {
    const renderable = create(stubTextures(['block']).loaded);
    renderable.update(FRAME);
    // Bottom-left: x = 400 + (6000 − 0.5 × 10000) × 0.02 = 420, y = 500 − 2000 × 0.02 = 460.
    // Size 96×32 logical px at scale 2: 192×64, so the top is 396.
    expect(boundsOf(renderable.container, 'back')).toEqual({
      x: 420,
      y: 396,
      width: 192,
      height: 64,
    });
    // Factor 1 on the ground line: x = 400 + (6000 − 10000) × 0.02 = 320, bottom at originY.
    expect(boundsOf(renderable.container, 'front')).toEqual({
      x: 320,
      y: 436,
      width: 192,
      height: 64,
    });
  });

  it('hides and shows one layer by id and throws on an unknown id', () => {
    const renderable = create(stubTextures(['block']).loaded);
    const visible = () => renderable.container.children.map((child) => child.visible);
    renderable.setLayerVisible('back', false);
    expect(visible()).toEqual([false, true, true]);
    renderable.setLayerVisible('back', true);
    expect(visible()).toEqual([true, true, true]);
    expect(() => renderable.setLayerVisible('sky', false)).toThrow(
      'Arena "test" has no layer "sky"; layers are: back, empty, front',
    );
  });

  it('destroy is idempotent and releases the textures exactly once', () => {
    const { textures, loaded, release } = stubTextures(['block']);
    const renderable = create(loaded);
    const { container } = renderable;
    expect(release).not.toHaveBeenCalled();
    renderable.destroy();
    expect(container.destroyed).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    // The textures are the release function's to destroy, not the display objects'.
    expect(Object.values(textures).every((texture) => !texture.destroyed)).toBe(true);
    renderable.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('throws naming the layer and texture id for a missing texture, after releasing the set', () => {
    const { loaded, release } = stubTextures(['other']);
    expect(() => create(loaded)).toThrow('Arena "test": layer "back" has no texture "block"');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

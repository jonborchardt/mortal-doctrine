// Public test fixtures (`@mortal-doctrine/arena/testing`). Geometric placeholder only, never a
// production arena. For tests and labs; production code must not import this entry point.
import type { Arena } from './schema';

const row = (texture: string, xs: readonly number[]) => xs.map((x) => ({ texture, x, y: 10_000 }));

/**
 * Four layers over the default 96000-wide gameplay arena, visual bounds 4000 sub-units beyond
 * each wall (parallax reference x = 48000). The ground strip is authored from y = 0 with its
 * top at `groundLine` 10000; everything else stands on it. Texture sizes in world units (the
 * manifest is the Studio fixture `fixtures/arena/manifest.json`): `sky` 1040×620, `far-tower`
 * 160×300, `mid-block` 100×160, `ground` 1040×100, `ground-post` 30×70.
 */
export const PLACEHOLDER_ARENA: Arena = {
  schemaVersion: 1,
  id: 'placeholder',
  groundLine: 10_000,
  visualBounds: { left: -4000, right: 100_000 },
  layers: [
    { id: 'sky', parallax: 0, images: [{ texture: 'sky', x: -4000, y: 0 }] },
    { id: 'far', parallax: 0.25, images: row('far-tower', [-12_000, 24_000, 60_000, 96_000]) },
    {
      id: 'mid',
      parallax: 0.5,
      images: row('mid-block', [-6000, 16_000, 38_000, 60_000, 82_000]),
    },
    {
      id: 'ground',
      parallax: 1,
      images: [
        { texture: 'ground', x: -4000, y: 0 },
        ...row('ground-post', [6500, 26_500, 46_500, 66_500, 86_500]),
      ],
    },
  ],
};

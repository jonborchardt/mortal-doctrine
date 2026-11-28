// The Training Hall: the gameplay arena rules a match is created with and the presentation data
// drawn for it, in one definition. Their consistency is checked by this package's tests.
import type { Arena } from '@mortal-doctrine/arena';
import type { ArenaRules } from '@mortal-doctrine/movement';

/** An arena's two halves: gameplay rules (simulation state) and presentation data (drawing). */
export interface TrainingHallDefinition {
  /** Pass as `createInitialState({ arena: rules })`. */
  readonly rules: ArenaRules;
  /** Pass to `createArenaRenderable`; `visualBounds` is the camera's `bounds`. */
  readonly arena: Arena;
}

const row = (texture: string, xs: readonly number[]) => xs.map((x) => ({ texture, x, y: 10_000 }));

/**
 * Width 96000 sub-units (equal to the default gameplay arena, so default-rules sessions and
 * replay stay usable until #216), no separation limit. Visual bounds 4000 sub-units beyond each
 * wall, centred on the gameplay range. Layers back to front: `sky` 0, `far` 0.25, `mid` 0.5,
 * `ground` 1. Textures: `assets/manifest.json`.
 */
export const TRAINING_HALL: TrainingHallDefinition = {
  rules: { width: 96_000 },
  arena: {
    schemaVersion: 1,
    id: 'training-hall',
    groundLine: 10_000,
    visualBounds: { left: -4000, right: 100_000 },
    layers: [
      { id: 'sky', parallax: 0, images: [{ texture: 'sun', x: 45_000, y: 25_000 }] },
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
  },
};

/// <reference types="node" />
// Content-layer test: reads the package's own asset files (Node only here; `src/` stays Node-free).
import { existsSync, readFileSync } from 'node:fs';
import { parseArena } from '@mortal-doctrine/arena';
import { arenaRulesSchema } from '@mortal-doctrine/movement';
import { parseTextureManifest } from '@mortal-doctrine/renderer';
import { createInitialState } from '@mortal-doctrine/simulation';
import { describe, expect, it } from 'vitest';
import { TRAINING_HALL } from '../src/index';

const { rules, arena } = TRAINING_HALL;
const manifestUrl = new URL('../assets/manifest.json', import.meta.url);

describe('training hall arena', () => {
  it('has rules and presentation data that pass their schemas unchanged', () => {
    expect(arenaRulesSchema.parse(rules)).toEqual(rules);
    expect(parseArena(structuredClone(arena))).toEqual(arena);
    expect(arena.id).toBe('training-hall');
  });

  it('has visual bounds that contain the gameplay range and are centred on it', () => {
    const { left, right } = arena.visualBounds;
    expect(left).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(rules.width);
    // The parallax reference is the centre of the gameplay arena.
    expect((left + right) / 2).toBe(rules.width / 2);
  });

  it('has a front-most gameplay-plane layer, so the drawn ground moves with the fighters', () => {
    expect(arena.layers.at(-1)?.parallax).toBe(1);
  });

  it('creates a match with its own rules', () => {
    expect(createInitialState({ arena: rules }).arena).toEqual(rules);
  });

  it('names only manifest textures, and every manifest path exists', () => {
    const urls = parseTextureManifest(
      JSON.parse(readFileSync(manifestUrl, 'utf8')),
      manifestUrl.href,
    );
    const used = arena.layers.flatMap((layer) => layer.images.map((image) => image.texture));
    expect(Object.keys(urls)).toEqual(expect.arrayContaining([...new Set(used)]));
    for (const url of Object.values(urls)) {
      expect(url.startsWith(new URL('../assets/', import.meta.url).href)).toBe(true);
      expect(existsSync(new URL(url)), url).toBe(true);
    }
  });
});

import { createInitialState, step, type SimulationState } from '@mortal-doctrine/simulation';
import { describe, expect, it } from 'vitest';
import { blendFighterX, defaultView, parseTextureManifest, worldToScreen } from '../src/index';

describe('default view', () => {
  it.each([
    [960, 540, 1, 460],
    [640, 360, 2 / 3, 360 - 80 * (2 / 3)],
    [1280, 720, 4 / 3, 720 - 80 * (4 / 3)],
  ])('frames %ix%i at scale %f with the ground line at y %f', (width, height, scale, ground) => {
    const view = defaultView(width, height);
    expect(view.scale).toBeCloseTo(scale, 9);
    const origin = worldToScreen(view, 0, 0);
    expect(origin.x).toBe(0);
    expect(origin.y).toBeCloseTo(ground, 9);
    const right = worldToScreen(view, 96000, 0);
    expect(right.x).toBeCloseTo(width, 9);
  });

  it('maps sub-units y-up to logical pixels y-down', () => {
    const view = defaultView(640, 360);
    const ground = worldToScreen(view, 48000, 0);
    expect(ground.x).toBeCloseTo(320, 9);
    expect(ground.y).toBeCloseTo(306.67, 2);
    const above = worldToScreen(view, 48000, 10000);
    expect(above.x).toBeCloseTo(320, 9);
    expect(above.y).toBeCloseTo(240, 9);
    expect(worldToScreen(defaultView(960, 540), 24000, 7000)).toEqual({ x: 240, y: 390 });
  });

  it('uses a custom view as given (the camera hook)', () => {
    const view = { scale: 2, originX: -100, originY: 500 };
    expect(worldToScreen(view, 10000, 5000)).toEqual({ x: 100, y: 400 });
  });
});

describe('blendFighterX', () => {
  const at = (frame: number, x0: number): SimulationState => {
    const initial = createInitialState();
    return { ...initial, frame, fighters: [{ x: x0 }, initial.fighters[1]] };
  };

  it('lerps x between a snapshot one frame behind and the current one', () => {
    expect(blendFighterX(at(4, 1000), at(5, 1400), 0, 0)).toBe(1000);
    expect(blendFighterX(at(4, 1000), at(5, 1400), 0, 0.25)).toBe(1100);
    expect(blendFighterX(at(4, 1000), at(5, 1400), 0, 0.999)).toBeCloseTo(1399.6, 6);
    const real = createInitialState();
    const next = step(real, [0, 0]).state;
    expect(blendFighterX(real, next, 1, 0.5)).toBe(next.fighters[1].x);
  });

  it('snaps to current x without a previous snapshot or when it is not exactly one frame behind', () => {
    expect(blendFighterX(undefined, at(5, 1400), 0, 0.5)).toBe(1400);
    expect(blendFighterX(at(3, 1000), at(5, 1400), 0, 0.5)).toBe(1400);
    expect(blendFighterX(at(50, 1000), at(0, 1400), 0, 0.5)).toBe(1400);
    expect(blendFighterX(at(5, 1000), at(5, 1400), 0, 0.5)).toBe(1400);
  });
});

describe('parseTextureManifest', () => {
  const MANIFEST_URL = 'https://example.test/characters/monk/assets/manifest.json';
  const parse = (json: unknown) => () => parseTextureManifest(json, MANIFEST_URL);

  it('accepts the convention example and resolves paths relative to the manifest URL', () => {
    expect(
      parseTextureManifest(
        { schemaVersion: 1, textures: { 'robe-torso': 'textures/robe-torso@2x.png' } },
        MANIFEST_URL,
      ),
    ).toEqual({
      'robe-torso': 'https://example.test/characters/monk/assets/textures/robe-torso@2x.png',
    });
    expect(parse({ schemaVersion: 1, textures: {} })()).toEqual({});
  });

  it('rejects an unknown schemaVersion', () => {
    expect(parse({ schemaVersion: 2, textures: {} })).toThrow(/schemaVersion 2/);
    expect(parse({ textures: {} })).toThrow(/schemaVersion undefined/);
  });

  it.each([
    ['a .. segment', 'textures/../secret@2x.png', /textures\.hero: must not contain "\.\."/],
    ['a backslash', 'textures\\hero@2x.png', /textures\.hero: must use forward slashes/],
    ['an absolute path', '/textures/hero@2x.png', /textures\.hero: must be relative/],
    ['an absolute URL', 'https://cdn.test/hero@2x.png', /textures\.hero: must be relative/],
    ['an empty path', '', /textures\.hero:/],
  ])('rejects %s, naming the texture id', (_, path, error) => {
    expect(parse({ schemaVersion: 1, textures: { hero: path } })).toThrow(error);
  });

  it.each([
    ['textures missing', { schemaVersion: 1 }, /textures:/],
    ['textures not an object', { schemaVersion: 1, textures: [] }, /textures:/],
    ['a non-string path', { schemaVersion: 1, textures: { hero: 3 } }, /textures\.hero:/],
    ['an unknown field', { schemaVersion: 1, textures: {}, atlas: 'x' }, /atlas/],
    ['not an object', 'manifest', /schemaVersion/],
  ])('rejects malformed JSON shape (%s), naming the field', (_, json, error) => {
    expect(parse(json)).toThrow(error);
  });
});

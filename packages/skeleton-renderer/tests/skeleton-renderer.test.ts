import { Texture, type Container, type Sprite } from 'pixi.js';
import { orderSlots, type AnimatedPose } from '@mortal-doctrine/animation';
import { apply, degToRad, type Transform } from '@mortal-doctrine/math';
import type { LoadedTextures, RenderFrame } from '@mortal-doctrine/renderer';
import { evaluate, loadRig, type Rig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG, NON_HUMANOID_RIG } from '@mortal-doctrine/rig/testing';
import { createInitialState } from '@mortal-doctrine/simulation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkeletonRenderable, slotDisplayTransform, type Facing } from '../src/index';

const MANNEQUIN = loadRig(MANNEQUIN_RIG);
const NON_HUMANOID = loadRig(NON_HUMANOID_RIG);
// 2 px per world unit; the character origin (50, 10) world units is at screen (200, 480).
const VIEW = { scale: 2, originX: 100, originY: 500 };
const ORIGIN = { x: 5000, y: 1000 };
const R2 = Math.SQRT2;

type Matrix6 = readonly [number, number, number, number, number, number];

function expectTransform(actual: Transform, [a, b, c, d, tx, ty]: Matrix6) {
  expect(actual.a).toBeCloseTo(a, 9);
  expect(actual.b).toBeCloseTo(b, 9);
  expect(actual.c).toBeCloseTo(c, 9);
  expect(actual.d).toBeCloseTo(d, 9);
  expect(actual.tx).toBeCloseTo(tx, 9);
  expect(actual.ty).toBeCloseTo(ty, 9);
}

const determinant = (t: Transform) => t.a * t.d - t.b * t.c;

function display(rig: Rig, pose: AnimatedPose, slotId: string, facing: Facing = 1): Transform {
  const slot = evaluate(rig, pose).slots.find(({ id }) => id === slotId);
  if (!slot) throw new Error(`No slot ${slotId}`);
  return slotDisplayTransform(slot.transform, facing, ORIGIN, VIEW);
}

// Hand-computed. A bone pointing up (90 degrees) maps image +x to screen up: (a, b) = (0, -2).
const MANNEQUIN_REST: Readonly<Record<string, Matrix6>> = {
  // spine starts at (0, 110): screen (200 + 0, 480 - 220).
  body: [0, -2, 2, 0, 200, 260],
  // head starts at (0, 150).
  face: [0, -2, 2, 0, 200, 180],
  // hand-right starts at (68, 146) and points right.
  'held-right': [2, 0, 0, 2, 336, 188],
};
const NON_HUMANOID_REST: Readonly<Record<string, Matrix6>> = {
  // wing-left-1 starts at (-5, 100) at 135 degrees; wing-right-1 at (5, 100) at 45 degrees.
  'wing-left': [-R2, -R2, R2, -R2, 190, 280],
  'wing-right': [R2, -R2, R2, R2, 210, 280],
  // core starts at (0, 60) pointing up.
  shell: [0, -2, 2, 0, 200, 360],
};
const FOREARM_UP: AnimatedPose = { bones: { 'forearm-right': { rotation: degToRad(90) } } };
// Elbow (40, 146), forearm 28 up: the hand starts at (40, 174) pointing up.
const HELD_RIGHT_FOREARM_UP: Matrix6 = [0, -2, 2, 0, 280, 132];

describe('slotDisplayTransform', () => {
  it.each([
    ['mannequin', MANNEQUIN, MANNEQUIN_REST],
    ['non-humanoid', NON_HUMANOID, NON_HUMANOID_REST],
  ])('places every %s slot at rest, never flipping the texture', (_, rig, expected) => {
    expect(rig.slots.map(({ id }) => id).sort()).toEqual(Object.keys(expected).sort());
    for (const [slot, matrix] of Object.entries(expected)) {
      const transform = display(rig, {}, slot);
      expectTransform(transform, matrix);
      expect(determinant(transform)).toBeCloseTo(4, 9);
    }
  });

  it('follows a posed bone', () => {
    expectTransform(display(MANNEQUIN, FOREARM_UP, 'held-right'), HELD_RIGHT_FOREARM_UP);
  });

  it('keeps a positive determinant for a scaled bone', () => {
    const transform = display(MANNEQUIN, { bones: { spine: { scale: { x: 2, y: 0.5 } } } }, 'body');
    // Twice as long along the bone (screen up), half as thick.
    expectTransform(transform, [0, -4, 1, 0, 200, 260]);
    expect(determinant(transform)).toBeCloseTo(4, 9);
  });

  it('facing -1 mirrors every point about the character origin, y unchanged', () => {
    // held-right starts 68 units right of the origin: 136 px right, then 136 px left.
    expectTransform(display(MANNEQUIN, {}, 'held-right', 1), [2, 0, 0, 2, 200 + 136, 188]);
    expectTransform(display(MANNEQUIN, {}, 'held-right', -1), [-2, 0, 0, 2, 200 - 136, 188]);

    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 13, y: -7 },
      { x: -3, y: 11 },
    ];
    for (const [rig, pose] of [
      [MANNEQUIN, FOREARM_UP],
      [NON_HUMANOID, {}],
    ] as const) {
      for (const { id } of rig.slots) {
        const right = display(rig, pose, id, 1);
        const left = display(rig, pose, id, -1);
        expect(determinant(left)).toBeCloseTo(-4, 9);
        for (const point of points) {
          const there = apply(right, point);
          const mirrored = apply(left, point);
          expect(mirrored.x).toBeCloseTo(2 * 200 - there.x, 9);
          expect(mirrored.y).toBeCloseTo(there.y, 9);
        }
      }
    }
  });
});

function stubTextures(rig: Rig, release = vi.fn(() => Promise.resolve())) {
  const textures = Object.fromEntries(rig.attachments.map(({ id }) => [id, new Texture()]));
  const loaded: LoadedTextures = { textures, urls: {}, release };
  return { textures, loaded, release };
}

const FRAME: RenderFrame = {
  state: createInitialState(),
  previous: undefined,
  alpha: 0,
  events: [],
  view: VIEW,
};

function spriteOf(container: Container, slot: string): Sprite {
  const sprite = container.children.find((child) => child.label === slot);
  if (!sprite) throw new Error(`No sprite for slot ${slot}`);
  return sprite as Sprite;
}

function localTransform(sprite: Sprite): Transform {
  sprite.updateLocalTransform();
  return sprite.localTransform;
}

const create = (rig: Rig, textures: LoadedTextures) =>
  createSkeletonRenderable({ rig, layer: 'fighters', textures });

describe('createSkeletonRenderable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['mannequin', MANNEQUIN, MANNEQUIN_REST],
    ['non-humanoid', NON_HUMANOID, NON_HUMANOID_REST],
  ])('draws the %s after one setPose + update', (_, rig, expected) => {
    const { textures, loaded } = stubTextures(rig);
    const renderable = create(rig, loaded);
    expect(renderable.layer).toBe('fighters');
    renderable.setPose({}, 1, ORIGIN);
    renderable.update(FRAME);

    expect(renderable.container.children).toHaveLength(rig.slots.length);
    for (const slot of rig.slots) {
      const sprite = spriteOf(renderable.container, slot.id);
      expect(sprite.visible).toBe(slot.attachment !== null);
      if (slot.attachment === null) continue;
      expect(sprite.texture).toBe(textures[slot.attachment]);
      expectTransform(localTransform(sprite), expected[slot.id] ?? [0, 0, 0, 0, 0, 0]);
      // Left-centre of the image on the slot origin.
      expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0, 0.5]);
    }
  });

  it('draws the rest pose at facing 1 and origin (0, 0) before any setPose', () => {
    const { textures, loaded } = stubTextures(MANNEQUIN);
    const renderable = create(MANNEQUIN, loaded);
    renderable.update(FRAME);
    const body = spriteOf(renderable.container, 'body');
    expect(body.visible).toBe(true);
    expect(body.texture).toBe(textures['body-plain']);
    // World origin is at screen (100, 500); spine starts 110 units up.
    expectTransform(localTransform(body), [0, -2, 2, 0, 100, 280]);
    expect(spriteOf(renderable.container, 'held-right').visible).toBe(false);
  });

  it('applies pose and facing changes on the next update', () => {
    const { loaded } = stubTextures(MANNEQUIN);
    const renderable = create(MANNEQUIN, loaded);
    renderable.update(FRAME);
    renderable.setPose({ ...FOREARM_UP, attachments: { 'held-right': 'staff' } }, 1, ORIGIN);
    renderable.update(FRAME);
    const held = spriteOf(renderable.container, 'held-right');
    expectTransform(localTransform(held), HELD_RIGHT_FOREARM_UP);

    renderable.setPose({ attachments: { 'held-right': 'staff' } }, -1, ORIGIN);
    renderable.update(FRAME);
    expectTransform(localTransform(held), [-2, 0, 0, 2, 64, 188]);
  });

  it('reorders children to the pose draw order on the same update, and back', () => {
    const { loaded } = stubTextures(MANNEQUIN);
    const renderable = create(MANNEQUIN, loaded);
    const order = () => renderable.container.children.map((child) => child.label);
    renderable.update(FRAME);
    expect(order()).toEqual(['body', 'face', 'held-right']);

    const drawOrder = ['held-right', 'body', 'face'];
    renderable.setPose({ drawOrder }, 1, ORIGIN);
    renderable.update(FRAME);
    expect(order()).toEqual(orderSlots(MANNEQUIN.slots, drawOrder).map(({ id }) => id));
    expect(order()).toEqual(drawOrder);

    // A partial order draws the listed slots in front of the rest.
    renderable.setPose({ drawOrder: ['body'] }, 1, ORIGIN);
    renderable.update(FRAME);
    expect(order()).toEqual(['face', 'held-right', 'body']);

    renderable.setPose({}, 1, ORIGIN);
    renderable.update(FRAME);
    expect(order()).toEqual(['body', 'face', 'held-right']);
  });

  it('switches and hides attachments on the same update', () => {
    const { textures, loaded } = stubTextures(MANNEQUIN);
    const renderable = create(MANNEQUIN, loaded);
    renderable.update(FRAME);
    const body = spriteOf(renderable.container, 'body');
    const held = spriteOf(renderable.container, 'held-right');

    renderable.setPose({ attachments: { body: 'body-robe', 'held-right': 'staff' } }, 1, ORIGIN);
    renderable.update(FRAME);
    expect(body.texture).toBe(textures['body-robe']);
    expect(held.visible).toBe(true);
    expect(held.texture).toBe(textures.staff);

    renderable.setPose({ attachments: { body: null } }, 1, ORIGIN);
    renderable.update(FRAME);
    expect(body.visible).toBe(false);
    expect(held.visible).toBe(false);
  });

  it('destroy is synchronous, destroys its display objects and releases the textures once', () => {
    const { textures, loaded, release } = stubTextures(NON_HUMANOID);
    const renderable = create(NON_HUMANOID, loaded);
    renderable.update(FRAME);
    const { container } = renderable;
    const sprites = [...container.children];
    expect(sprites).toHaveLength(3);

    expect(renderable.destroy()).toBeUndefined();
    expect(container.destroyed).toBe(true);
    expect(sprites.map((sprite) => sprite.destroyed)).toEqual([true, true, true]);
    expect(release).toHaveBeenCalledTimes(1);
    // The textures are the release function's to destroy, not the display objects'.
    expect(Object.values(textures).every((texture) => !texture.destroyed)).toBe(true);

    renderable.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports a failed release with console.error instead of an unhandled rejection', async () => {
    const failure = new Error('unload failed');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { loaded, release } = stubTextures(
      MANNEQUIN,
      vi.fn(() => Promise.reject(failure)),
    );
    create(MANNEQUIN, loaded).destroy();
    expect(release).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(failure));
  });

  it('throws naming an attachment without a texture, after releasing the set', () => {
    const { textures, release } = stubTextures(MANNEQUIN);
    const withoutStaff = Object.fromEntries(
      Object.entries(textures).filter(([id]) => id !== 'staff'),
    );
    expect(() => create(MANNEQUIN, { textures: withoutStaff, urls: {}, release })).toThrow(
      /attachment "staff" has no texture/,
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});

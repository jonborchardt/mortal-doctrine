import { Texture, type Container, type MeshSimple } from 'pixi.js';
import { loadMesh, type AnimatedPose, type Mesh } from '@mortal-doctrine/animation';
import { LIMB_MESH, LIMB_RIG } from '@mortal-doctrine/animation/testing';
import { degToRad } from '@mortal-doctrine/math';
import type { LoadedTextures, RenderFrame } from '@mortal-doctrine/renderer';
import { loadRig, type Rig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';
import { createInitialState } from '@mortal-doctrine/simulation';
import { describe, expect, it, vi } from 'vitest';
import { createSkeletonRenderable, type Facing } from '../src/index';

// 2 px per world unit; the character origin (50, 10) world units is at screen (200, 480).
const VIEW = { scale: 2, originX: 100, originY: 500 };
const ORIGIN = { x: 5000, y: 1000 };
const FRAME: RenderFrame = {
  state: createInitialState(),
  previous: undefined,
  alpha: 0,
  events: [],
  view: VIEW,
};

const LIMB = loadRig(LIMB_RIG);
const LIMB_SKIN = loadMesh(LIMB, LIMB_MESH);
// The limb slot with a second mesh attachment, `limb-bare`, using the same geometry.
const TWO_SKINS = loadRig({
  ...LIMB_RIG,
  attachments: [...LIMB_RIG.attachments, { id: 'limb-bare', slot: 'limb' }],
});
const TWO_SKIN_MESHES = [
  loadMesh(TWO_SKINS, LIMB_MESH),
  loadMesh(TWO_SKINS, { ...LIMB_MESH, attachment: 'limb-bare' }),
];

function stubTextures(rig: Rig) {
  const release = vi.fn(() => Promise.resolve());
  const textures = Object.fromEntries(rig.attachments.map(({ id }) => [id, new Texture()]));
  const loaded: LoadedTextures = { textures, urls: {}, release };
  return { textures, loaded, release };
}

const create = (rig: Rig, textures: LoadedTextures, meshes: readonly Mesh[]) =>
  createSkeletonRenderable({ rig, layer: 'fighters', textures, meshes });

function meshOf(container: Container, attachment: string): MeshSimple {
  const mesh = container.children
    .flatMap((slot) => slot.children)
    .find((child) => child.label === attachment);
  if (!mesh) throw new Error(`No mesh for ${attachment}`);
  return mesh as MeshSimple;
}

function draw(pose: AnimatedPose, facing: Facing = 1) {
  const renderable = create(LIMB, stubTextures(LIMB).loaded, [LIMB_SKIN]);
  renderable.setPose(pose, facing, ORIGIN);
  renderable.update(FRAME);
  return renderable;
}

/** Screen points (x, y) of the listed vertex indices. */
function expectVertices(mesh: MeshSimple, expected: Readonly<Record<number, [number, number]>>) {
  for (const [index, [x, y]] of Object.entries(expected)) {
    // Float32 geometry.
    expect(mesh.vertices[2 * Number(index)]).toBeCloseTo(x, 3);
    expect(mesh.vertices[2 * Number(index) + 1]).toBeCloseTo(y, 3);
  }
}

const LOWER_90: AnimatedPose = { bones: { lower: { rotation: degToRad(90) } } };

// Hand-computed screen coordinates: at = (200, 480), screen = (200 + 2 · facing · x, 480 - 2 · y)
// for the rig-space vertex (x, y) (see the animation package's skinning tests).
describe('skeleton renderable meshes', () => {
  it('writes skinned vertices as screen coordinates, every update', () => {
    const renderable = draw({});
    const mesh = meshOf(renderable.container, 'limb-skin');
    expect(mesh.visible).toBe(true);
    expect(mesh.texture).toBeInstanceOf(Texture);
    expect(mesh.vertices).toHaveLength(20);
    expectVertices(mesh, {
      0: [80, 260], // (-60, 110)
      8: [320, 260], // (60, 110)
      9: [320, 300], // (60, 90)
    });

    renderable.setPose(LOWER_90, 1, ORIGIN);
    renderable.update(FRAME);
    expectVertices(mesh, {
      0: [80, 260], // (-60, 110): upper only, unmoved
      4: [190, 270], // (-5, 105): 0.5 / 0.5 at the joint
      7: [220, 270], // (10, 105): 0.25 / 0.75
      8: [180, 160], // (-10, 160)
      9: [220, 160], // (10, 160)
    });
    // The limb tip is 160 units up: above the origin on screen, y-up not flipped.
    expect(mesh.vertices[2 * 8 + 1]).toBeLessThan(480);
    // Identity local transform: the geometry already holds the screen position.
    mesh.updateLocalTransform();
    const { a, b, c, d, tx, ty } = mesh.localTransform;
    expect([a, b, c, d, tx, ty]).toEqual([1, 0, 0, 1, 0, 0]);

    renderable.setPose({ bones: { upper: { rotation: degToRad(90) } } }, 1, ORIGIN);
    renderable.update(FRAME);
    expectVertices(mesh, {
      0: [60, 280], // (-70, 100)
      8: [60, 40], // (-70, 220)
    });
    renderable.destroy();
  });

  it('facing -1 mirrors the vertices about the character origin', () => {
    const renderable = draw(LOWER_90, -1);
    expectVertices(meshOf(renderable.container, 'limb-skin'), {
      0: [320, 260],
      4: [210, 270],
      8: [220, 160],
      9: [180, 160],
    });
    renderable.destroy();
  });

  it('shows only the active attachment mesh and never rebuilds geometry', () => {
    const renderable = create(TWO_SKINS, stubTextures(TWO_SKINS).loaded, TWO_SKIN_MESHES);
    const skin = meshOf(renderable.container, 'limb-skin');
    const bare = meshOf(renderable.container, 'limb-bare');
    const geometries = [skin.geometry, bare.geometry];
    // Both meshes are in the one slot child.
    expect(renderable.container.children).toHaveLength(1);
    renderable.update(FRAME);
    expect([skin.visible, bare.visible]).toEqual([true, false]);

    renderable.setPose({ attachments: { limb: 'limb-bare' } }, 1, ORIGIN);
    renderable.update(FRAME);
    expect([skin.visible, bare.visible]).toEqual([false, true]);
    expectVertices(bare, { 8: [320, 260] });

    renderable.setPose({ attachments: { limb: null } }, 1, ORIGIN);
    renderable.update(FRAME);
    expect([skin.visible, bare.visible]).toEqual([false, false]);
    expect([skin.geometry, bare.geometry]).toEqual(geometries);
    expect(skin.geometry).toBe(geometries[0]);
    renderable.destroy();
  });

  it('destroy destroys the meshes, their geometry and the container, releasing textures once', () => {
    const { textures, loaded, release } = stubTextures(TWO_SKINS);
    const renderable = create(TWO_SKINS, loaded, TWO_SKIN_MESHES);
    renderable.update(FRAME);
    const { container } = renderable;
    const meshes = [meshOf(container, 'limb-skin'), meshOf(container, 'limb-bare')];
    const geometries = meshes.map((mesh) => mesh.geometry);
    const buffers = geometries.flatMap((geometry) => geometry.buffers);
    const destroys = geometries.map((geometry) => vi.spyOn(geometry, 'destroy'));

    expect(renderable.destroy()).toBeUndefined();
    expect(container.destroyed).toBe(true);
    expect(meshes.map((mesh) => mesh.destroyed)).toEqual([true, true]);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
    expect(buffers.length).toBeGreaterThan(0);
    expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(Object.values(textures).every((texture) => !texture.destroyed)).toBe(true);

    renderable.destroy();
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a mesh bound to another rig',
      LIMB,
      [loadMesh(loadRig({ ...LIMB_RIG, id: 'other' }), LIMB_MESH)],
      'Rig "limb": mesh "limb-skin" is for rig "other"',
    ],
    [
      'a slot mixing mesh and sprite attachments',
      TWO_SKINS,
      [TWO_SKIN_MESHES[0]],
      'Rig "limb": slot "limb" mixes mesh and sprite attachments',
    ],
    [
      'two meshes for one attachment',
      LIMB,
      [LIMB_SKIN, LIMB_SKIN],
      'Rig "limb": two meshes for attachment "limb-skin"',
    ],
    [
      'a mesh of the limb on the mannequin',
      loadRig(MANNEQUIN_RIG),
      [LIMB_SKIN],
      'Rig "mannequin": mesh "limb-skin" is for rig "limb"',
    ],
  ] as const)('throws for %s, after releasing the textures', (_, rig, meshes, message) => {
    const { loaded, release } = stubTextures(rig);
    expect(() => create(rig, loaded, meshes as readonly Mesh[])).toThrow(message);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

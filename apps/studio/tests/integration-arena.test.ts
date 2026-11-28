import { parallaxToScreen } from '@mortal-doctrine/arena';
import { createCamera, visibleSpan } from '@mortal-doctrine/camera';
import { DEFAULT_ARENA_RULES, pushboxOf } from '@mortal-doctrine/movement';
import { worldToScreen } from '@mortal-doctrine/renderer';
import { InputBit, type FrameInputs } from '@mortal-doctrine/sim-core';
import { createInitialState, type SimulationState } from '@mortal-doctrine/simulation';
import { runFrames } from '@mortal-doctrine/simulation/testing';
import { describe, expect, it } from 'vitest';
import { ARENA, CAMERA_CONFIG, SESSION_OPTIONS } from '@mortal-doctrine/match-view/testing';

const { LEFT, RIGHT } = InputBit;
const INITIAL = createInitialState(SESSION_OPTIONS);
const { width } = INITIAL.arena;
const { viewport } = CAMERA_CONFIG;

/** Both fighters holding `inputs` until they stop: 400 frames cross the arena at walk speed. */
const walked = (inputs: FrameInputs): SimulationState =>
  runFrames(INITIAL, () => inputs, 400).state;

// Snapshots with fighters at the gameplay walls, reached through production movement.
const AT_WALLS = {
  'both at the left wall': walked([LEFT, LEFT]),
  'both at the right wall': walked([RIGHT, RIGHT]),
  'one at each wall': walked([LEFT, RIGHT]),
};

const edges = (state: SimulationState) =>
  state.fighters.flatMap((fighter) => {
    const half = pushboxOf(fighter).width / 2;
    return [fighter.x - half, fighter.x + half];
  });

describe('placeholder arena against the gameplay arena', () => {
  it('is checked against the default gameplay arena rules', () => {
    expect(INITIAL.arena).toEqual(DEFAULT_ARENA_RULES);
  });

  it('has visual bounds that contain the whole gameplay range and are centred on it', () => {
    const { left, right } = ARENA.visualBounds;
    expect(left).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(width);
    // The parallax reference is the centre of the gameplay arena.
    expect((left + right) / 2).toBe(width / 2);
    expect(CAMERA_CONFIG.bounds).toEqual(ARENA.visualBounds);
  });

  it('has a gameplay-plane layer, so the drawn ground moves with the fighters', () => {
    expect(ARENA.layers.at(-1)).toMatchObject({ id: 'ground', parallax: 1 });
  });

  it('reaches both gameplay walls in the wall cases', () => {
    expect(Math.min(...edges(AT_WALLS['both at the left wall']))).toBe(0);
    expect(Math.max(...edges(AT_WALLS['both at the right wall']))).toBe(width);
    expect(edges(AT_WALLS['one at each wall'])).toEqual(expect.arrayContaining([0, width]));
  });

  it.each(Object.entries(AT_WALLS))(
    'shows the fighters standing on the ground line with %s',
    (_name, state) => {
      const { view } = createCamera(CAMERA_CONFIG).update(state);
      const span = visibleSpan(view, viewport.width);
      // The span is float math on the view: allow rounding at the bounds, far below a sub-unit.
      expect(span.left).toBeGreaterThanOrEqual(ARENA.visualBounds.left - 1e-6);
      expect(span.right).toBeLessThanOrEqual(ARENA.visualBounds.right + 1e-6);
      expect(span.left).toBeLessThanOrEqual(Math.min(...edges(state)));
      expect(span.right).toBeGreaterThanOrEqual(Math.max(...edges(state)));

      for (const fighter of state.fighters) {
        // A grounded fighter (gameplay y = 0) is drawn on the arena's ground line, at the x the
        // gameplay-plane layer (parallax 1) gives the same world x.
        expect(fighter.y).toBe(0);
        const feet = worldToScreen(view, fighter.x, fighter.y);
        const ground = parallaxToScreen(
          view,
          viewport.width,
          ARENA,
          1,
          fighter.x,
          ARENA.groundLine,
        );
        expect(ground.x).toBeCloseTo(feet.x, 9);
        expect(ground.y).toBeCloseTo(feet.y, 9);
        expect(feet.y).toBeLessThan(viewport.height);
      }
    },
  );
});

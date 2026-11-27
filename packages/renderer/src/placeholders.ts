import { Container, Graphics } from 'pixi.js';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import { FIGHTER_WIDTH } from '@mortal-doctrine/simulation';
import type { Renderable } from './renderer';
import { blendFighterX, defaultView, worldToScreen } from './view';

// Presentation-only sizes in world units: these never feed back into the simulation.
const FIGHTER_HEIGHT = 140;
const FLOOR_COLOR = 0x4a4458;
const FIGHTER_COLORS = [0xe0533d, 0x3d8fe0] as const;

/** Floor filling the viewport below the ground line. */
export function createPlaceholderFloor(width: number, height: number): Renderable {
  // Drawn down to the bottom edge from any ground line; the canvas clips the excess.
  const floor = new Graphics().rect(0, 0, width, height).fill(FLOOR_COLOR);
  floor.y = defaultView(width, height).originY;
  return {
    layer: 'background',
    container: floor,
    update({ view }) {
      floor.y = view.originY;
    },
    destroy: () => floor.destroy(),
  };
}

/** Both fighters as rectangles standing on the ground line, x interpolated when asked. */
export function createPlaceholderFighters(): Renderable {
  const container = new Container({ label: 'placeholder-fighters' });
  // Drawn in world units with the origin at the fighter's feet; the view scales them.
  const fighterWidth = FIGHTER_WIDTH / SUBUNITS_PER_UNIT;
  const bodies = FIGHTER_COLORS.map((color) =>
    new Graphics()
      .rect(-fighterWidth / 2, -FIGHTER_HEIGHT, fighterWidth, FIGHTER_HEIGHT)
      .fill(color),
  );
  container.addChild(...bodies);
  return {
    layer: 'fighters',
    container,
    update({ state, previous, alpha, view }) {
      bodies.forEach((body, player) => {
        const x = blendFighterX(previous, state, player as 0 | 1, alpha);
        const screen = worldToScreen(view, x, 0);
        body.position.set(screen.x, screen.y);
        body.scale.set(view.scale);
      });
    },
    destroy: () => container.destroy({ children: true }),
  };
}

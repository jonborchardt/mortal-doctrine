import { Application, Graphics, UPDATE_PRIORITY } from 'pixi.js';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import { FIGHTER_WIDTH, type SimulationState } from '@mortal-doctrine/simulation';

// Presentation-only dimensions in logical pixels: these never feed back into the simulation.
// One world unit (SUBUNITS_PER_UNIT simulation sub-units) is one logical pixel.
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const FLOOR_Y = 460;
const FIGHTER_HEIGHT = 140;
const BACKGROUND = 0x15131c;
const FLOOR_COLOR = 0x4a4458;
const FIGHTER_COLORS = [0xe0533d, 0x3d8fe0] as const;

export interface ArenaRenderer {
  /** Draws a simulation snapshot. Read-only with respect to the snapshot. */
  render(state: SimulationState): void;
  /** Subscribes to display frames (decoupled from simulation ticks). Returns an unsubscribe. */
  onFrame(callback: (elapsedMs: number) => void): () => void;
  /** Smoothed display frames per second. */
  readonly fps: number;
  /**
   * CPU time of the previous display frame in ms: frame callbacks, scene update and draw
   * submission. Excludes GPU execution time, which the browser does not expose cheaply.
   */
  readonly frameCpuMs: number;
  destroy(): void;
}

/** Creates a PixiJS view and appends its canvas to `host`. */
export async function createArenaRenderer(host: HTMLElement): Promise<ArenaRenderer> {
  const app = new Application();
  await app.init({ width: VIEW_WIDTH, height: VIEW_HEIGHT, background: BACKGROUND });

  const floor = new Graphics()
    .rect(0, FLOOR_Y, VIEW_WIDTH, VIEW_HEIGHT - FLOOR_Y)
    .fill(FLOOR_COLOR);
  // Origin at the fighter's feet, matching the simulation's x coordinate.
  const fighterWidth = FIGHTER_WIDTH / SUBUNITS_PER_UNIT;
  const fighters = FIGHTER_COLORS.map((color) =>
    new Graphics()
      .rect(-fighterWidth / 2, -FIGHTER_HEIGHT, fighterWidth, FIGHTER_HEIGHT)
      .fill(color),
  );
  app.stage.addChild(floor, ...fighters);
  // The logical viewport is fixed; CSS scales it down to fit narrower hosts.
  Object.assign(app.canvas.style, { display: 'block', width: '100%', height: 'auto' });
  host.appendChild(app.canvas);

  // Pixi renders at LOW priority; bracketing with the highest and lowest priorities times
  // the whole frame, including our own callbacks and the draw.
  let frameStart = 0;
  let frameCpuMs = 0;
  app.ticker.add(() => (frameStart = performance.now()), undefined, UPDATE_PRIORITY.INTERACTION);
  app.ticker.add(
    () => (frameCpuMs = performance.now() - frameStart),
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

  return {
    render(state) {
      state.fighters.forEach((fighter, index) => {
        fighters[index]?.position.set(fighter.x / SUBUNITS_PER_UNIT, FLOOR_Y);
      });
    },
    onFrame(callback) {
      const listener = () => callback(app.ticker.deltaMS);
      app.ticker.add(listener);
      return () => app.ticker.remove(listener);
    },
    get fps() {
      return app.ticker.FPS;
    },
    get frameCpuMs() {
      return frameCpuMs;
    },
    destroy() {
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

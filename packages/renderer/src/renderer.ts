import { Application, Container, UPDATE_PRIORITY } from 'pixi.js';
import type { SimulationEvent, SimulationState } from '@mortal-doctrine/simulation';
import { createPlaceholderFighters, createPlaceholderFloor } from './placeholders';
import { defaultView, type View } from './view';

const BACKGROUND = 0x15131c;
const DEFAULT_LAYERS = ['background', 'fighters', 'effects', 'overlay'] as const;

export interface ArenaRendererOptions {
  /** Logical viewport in pixels (canvas size). Default 960×540. */
  readonly width?: number;
  readonly height?: number;
  /** Layer names, bottom first. Default `background`, `fighters`, `effects`, `overlay`. */
  readonly layers?: readonly string[];
  /** Registers the placeholder floor (`background`) and fighters (`fighters`). Default true. */
  readonly placeholders?: boolean;
}

/** What a renderable receives on every drawn frame. Read-only. */
export interface RenderFrame {
  readonly state: SimulationState;
  /** Snapshot one tick before `state` when the host interpolates; otherwise undefined. */
  readonly previous: SimulationState | undefined;
  /** Fraction of a tick elapsed since `state` (0 when not interpolating). */
  readonly alpha: number;
  /** Events of the ticks run since the previous drawn frame, in tick order. */
  readonly events: readonly SimulationEvent[];
  readonly view: View;
}

/** A drawable mounted into one layer. It applies `frame.view` itself. */
export interface Renderable {
  readonly layer: string;
  /** Added to the layer's container on register, removed on unregister. */
  readonly container: Container;
  update(frame: RenderFrame): void;
  /** Called once, on unregister or renderer destroy; releases what the renderable owns. */
  destroy(): void;
}

export interface ArenaRenderer {
  /**
   * Draws a simulation snapshot by updating every registered renderable. Read-only with respect
   * to the snapshot. `previous`, `alpha` and `events` default to none, 0 and none.
   */
  render(
    state: SimulationState,
    extra?: Partial<Pick<RenderFrame, 'previous' | 'alpha' | 'events'>>,
  ): void;
  /** Camera hook: replaces the world → screen mapping from the next drawn frame. */
  setView(view: View): void;
  /** Mounts `renderable` in its layer. Returns an idempotent unregister (which calls `destroy`). */
  register(renderable: Renderable): () => void;
  /** Subscribes to display frames (decoupled from simulation ticks). Returns an unsubscribe. */
  onFrame(callback: (elapsedMs: number) => void): () => void;
  /** Smoothed display frames per second. */
  readonly fps: number;
  /**
   * CPU time of the previous display frame in ms: frame callbacks, scene update and draw
   * submission. Excludes GPU execution time, which the browser does not expose cheaply.
   */
  readonly frameCpuMs: number;
  /** Destroys every registered renderable, the Pixi app and its canvas. */
  destroy(): void;
}

const NO_EVENTS: readonly SimulationEvent[] = Object.freeze([]);

/** Creates a PixiJS view and appends its canvas to `host`. */
export async function createArenaRenderer(
  host: HTMLElement,
  {
    width = 960,
    height = 540,
    layers = DEFAULT_LAYERS,
    placeholders = true,
  }: ArenaRendererOptions = {},
): Promise<ArenaRenderer> {
  const unknownLayer = (name: string) =>
    new Error(`Unknown renderer layer "${name}"; layers are: ${layers.join(', ')}`);
  // Checked before creating the app so a bad option cannot leak a canvas.
  if (placeholders) {
    for (const name of ['background', 'fighters']) {
      if (!layers.includes(name)) throw unknownLayer(name);
    }
  }
  const app = new Application();
  await app.init({ width, height, background: BACKGROUND });

  const layerContainers = new Map(layers.map((name) => [name, new Container({ label: name })]));
  app.stage.addChild(...layerContainers.values());
  // The logical viewport is fixed; CSS scales it to the host's width.
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

  let view = defaultView(width, height);
  const mounted = new Set<Renderable>();
  let destroyed = false;
  const unmount = (renderable: Renderable) => {
    if (!mounted.delete(renderable)) return;
    renderable.container.removeFromParent();
    renderable.destroy();
  };

  const renderer: ArenaRenderer = {
    render(state, extra = {}) {
      const frame: RenderFrame = {
        state,
        previous: extra.previous,
        alpha: extra.alpha ?? 0,
        events: extra.events ?? NO_EVENTS,
        view,
      };
      for (const renderable of mounted) renderable.update(frame);
    },
    setView(next) {
      view = next;
    },
    register(renderable) {
      // A late registration (e.g. after an async texture load) must not leak what it owns.
      if (destroyed) {
        renderable.destroy();
        return () => {};
      }
      const layer = layerContainers.get(renderable.layer);
      if (!layer) throw unknownLayer(renderable.layer);
      layer.addChild(renderable.container);
      mounted.add(renderable);
      return () => unmount(renderable);
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
      destroyed = true;
      for (const renderable of [...mounted]) unmount(renderable);
      app.destroy({ removeView: true }, { children: true });
    },
  };

  if (placeholders) {
    renderer.register(createPlaceholderFloor(width, height));
    renderer.register(createPlaceholderFighters());
  }
  return renderer;
}

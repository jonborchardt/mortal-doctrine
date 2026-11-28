import {
  createSimulationRunner,
  type InitialStateOptions,
  type InputProvider,
  type SimulationEvent,
  type SimulationRunner,
  type SimulationState,
} from '@mortal-doctrine/simulation';
import {
  createArenaRenderer,
  type ArenaRenderer,
  type ArenaRendererOptions,
} from '@mortal-doctrine/renderer';

/** Passed to the host's per-frame callback after the simulation advanced and the frame was drawn. */
export interface SimFrame {
  readonly elapsedMs: number;
  /** Ticks run by `advance` this frame (excludes `stepOnce`). */
  readonly ticks: number;
  readonly events: readonly SimulationEvent[];
  /** Wall time spent in `runner.advance`, in ms. */
  readonly simMs: number;
  readonly state: SimulationState;
}

export interface SimLoopOptions {
  /** Called once per tick for that tick's inputs. */
  readonly inputs: InputProvider;
  readonly onFrame?: (frame: SimFrame) => void;
  readonly renderer?: ArenaRendererOptions;
  readonly runner?: InitialStateOptions;
  /** Blend placeholder fighters between the previous and current snapshot. Default false. */
  readonly interpolate?: boolean;
}

export interface SimLoop {
  /** Resolves once the renderer exists and frames run; rejects if it could not be created. */
  readonly ready: Promise<void>;
  readonly runner: SimulationRunner;
  /** Undefined until `ready` resolves and after `destroy`. */
  readonly renderer: ArenaRenderer | undefined;
  /** Changeable at runtime; takes effect on the next drawn frame. */
  interpolate: boolean;
  /** Runs one tick regardless of pause; its events also reach renderables on the next frame. */
  stepOnce(): readonly SimulationEvent[];
  /** Stops frames and destroys the renderer. Safe before `ready` resolves and when repeated. */
  destroy(): void;
}

/**
 * The Simulation Lab's frame loop: owns a renderer, a simulation runner and the display-frame
 * subscription that drives both. Hosts that need a camera or replay use `match-view` instead.
 */
export function startSimLoop(host: HTMLElement, options: SimLoopOptions): SimLoop {
  const runner = createSimulationRunner(options.runner);
  let renderer: ArenaRenderer | undefined;
  let destroyed = false;
  let unsubscribe = () => {};
  // Snapshot before the last tick run, captured as the runner asks for that tick's inputs.
  let previous: SimulationState | undefined;
  let pending: SimulationEvent[] = [];
  const inputs: InputProvider = (frame) => {
    previous = runner.state;
    return options.inputs(frame);
  };

  const loop: SimLoop = {
    ready: createArenaRenderer(host, options.renderer).then((created) => {
      if (destroyed) return created.destroy();
      renderer = created;
      unsubscribe = created.onFrame((elapsedMs) => {
        const started = performance.now();
        const { ticks, events } = runner.advance(elapsedMs, inputs);
        const simMs = performance.now() - started;
        const frameEvents = pending.length ? [...pending, ...events] : events;
        pending = [];
        const { state } = runner;
        // Paused, alpha stays 0: blending would draw the snapshot one tick behind the frame shown.
        created.render(
          state,
          loop.interpolate && !runner.paused
            ? { previous, alpha: runner.alpha, events: frameEvents }
            : { events: frameEvents },
        );
        options.onFrame?.({ elapsedMs, ticks, events, simMs, state });
      });
    }),
    runner,
    get renderer() {
      return renderer;
    },
    interpolate: options.interpolate ?? false,
    stepOnce() {
      const events = runner.stepOnce(inputs);
      pending.push(...events);
      return events;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      renderer?.destroy();
      renderer = undefined;
    },
  };
  return loop;
}

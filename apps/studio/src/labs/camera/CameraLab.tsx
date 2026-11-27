import { useEffect, useRef, useState } from 'react';
import { Graphics } from 'pixi.js';
import { createCamera, visibleSpan, type CameraOutput } from '@mortal-doctrine/camera';
import { FIXTURE_CAMERA_CONFIG } from '@mortal-doctrine/camera/testing';
import type { ArenaRules } from '@mortal-doctrine/movement';
import { MOVEMENT_SCENARIOS } from '@mortal-doctrine/movement/testing';
import { createArenaRenderer, worldToScreen, type Renderable } from '@mortal-doctrine/renderer';
import {
  createSimulationRunner,
  type InputProvider,
  type SimulationEvent,
} from '@mortal-doctrine/simulation';
import { walkCycleScript } from '@mortal-doctrine/simulation/testing';

const CONFIG = FIXTURE_CAMERA_CONFIG;
const { viewport, bounds } = CONFIG;

interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly arena?: ArenaRules;
  readonly inputs: InputProvider;
}

// Scripted fighter movement from the simulation and movement fixtures.
const SCENARIOS: readonly Scenario[] = [
  ...MOVEMENT_SCENARIOS,
  { id: 'walk-cycle', name: 'Walk cycle: both fighters, looping', inputs: walkCycleScript },
];
const DEFAULT_SCENARIO = SCENARIOS[0] as Scenario;

interface Trigger {
  readonly type: SimulationEvent['type'];
  readonly make: (frame: number) => SimulationEvent;
}

// One manual trigger per event type the camera configuration shakes on.
const TRIGGERS = (
  [
    { type: 'land', make: (frame) => ({ type: 'land', frame, player: 0 }) },
    {
      type: 'wall-contact',
      make: (frame) => ({ type: 'wall-contact', frame, player: 0, side: 'left' }),
    },
  ] satisfies Trigger[]
).filter(({ type }) => CONFIG.shake[type]);

const OVERLAY_COLORS = { ruler: 0x8a8398, bounds: 0xf2c14e, target: 0x4ed8f2, midpoint: 0xffffff };
const RULER_STEP = 10_000;

/** Control actions, created with the session inside the effect. */
interface Actions {
  /** Returns whether the runner is now paused. */
  togglePause(): boolean;
  step(): void;
  reset(): void;
  choose(id: string): void;
  trigger(type: string): void;
  setOverlay(shown: boolean): void;
}

/**
 * Lab-local overlay in the `overlay` layer: a ground ruler every 100 world units, the visual
 * bounds, the frame the camera is converging to and the fighters' midpoint.
 */
function createOverlay(read: () => { output: CameraOutput | null; shown: boolean }): Renderable {
  const graphics = new Graphics();
  return {
    layer: 'overlay',
    container: graphics,
    update({ state, view }) {
      const { output, shown } = read();
      graphics.clear();
      if (!output || !shown) return;
      const x = (world: number) => worldToScreen(view, world, 0).x;
      const ground = view.originY;
      for (let world = bounds.left; world <= bounds.right; world += RULER_STEP) {
        graphics.rect(x(world) - 1, ground - 8, 2, 16);
      }
      graphics.fill(OVERLAY_COLORS.ruler);
      // Bars sit just inside the edge they mark, so they show when the frame touches it.
      graphics
        .rect(x(bounds.left), 0, 6, viewport.height)
        .rect(x(bounds.right) - 6, 0, 6, viewport.height)
        .fill(OVERLAY_COLORS.bounds);
      graphics
        .rect(x(output.target.left), 40, 3, viewport.height - 80)
        .rect(x(output.target.right) - 3, 40, 3, viewport.height - 80)
        .fill(OVERLAY_COLORS.target);
      const midpoint = (state.fighters[0].x + state.fighters[1].x) / 2;
      graphics.rect(x(midpoint) - 1, ground - 220, 2, 240).fill(OVERLAY_COLORS.midpoint);
    },
    destroy: () => graphics.destroy(),
  };
}

export function CameraLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(true);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO.id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    let disposed = false;
    let teardown = () => {};

    createArenaRenderer(host, viewport)
      .then((renderer) => {
        if (disposed) return renderer.destroy();
        let scenario = DEFAULT_SCENARIO;
        let runner = createSimulationRunner();
        let camera = createCamera(CONFIG);
        let output: CameraOutput | null = null;
        let shown = true;
        /** Manual triggers waiting for the next tick. */
        let pending: Trigger[] = [];
        /** Events of the ticks run since the camera last saw a snapshot. */
        let unseen: SimulationEvent[] = [];

        // A fresh, paused runner at frame 0 and a camera with no history.
        const load = () => {
          runner = createSimulationRunner(scenario.arena ? { arena: scenario.arena } : {});
          runner.pause();
          camera = createCamera(CONFIG);
          pending = [];
          unseen = [];
        };
        load();
        // Manual triggers become events of the tick just run, like the simulation's own.
        const ticked = (events: readonly SimulationEvent[]) => {
          const frame = runner.state.frame - 1;
          unseen.push(...events, ...pending.map(({ make }) => make(frame)));
          pending = [];
        };

        actionsRef.current = {
          togglePause() {
            if (runner.paused) runner.resume();
            else runner.pause();
            return runner.paused;
          },
          step() {
            ticked(runner.stepOnce(scenario.inputs));
          },
          reset: load,
          choose(id) {
            scenario = SCENARIOS.find((s) => s.id === id) ?? DEFAULT_SCENARIO;
            load();
          },
          trigger(type) {
            pending.push(...TRIGGERS.filter((trigger) => trigger.type === type));
          },
          setOverlay(next) {
            shown = next;
          },
        };

        const unregister = renderer.register(createOverlay(() => ({ output, shown })));
        const readouts = new Map(
          [...root.querySelectorAll<HTMLElement>('[data-readout]')].map((el) => [
            el.dataset.readout,
            el,
          ]),
        );
        const write = (key: string, text: string) => {
          const element = readouts.get(key);
          if (element && element.textContent !== text) element.textContent = text;
        };

        // Per-frame work stays outside React; React only handles control clicks.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          const { ticks, events } = runner.advance(elapsedMs, scenario.inputs);
          if (ticks > 0) ticked(events);
          const { state } = runner;
          output = camera.update(state, unseen);
          unseen = [];
          // The view is set before the snapshot is drawn, so the camera never trails a frame.
          renderer.setView(output.view);
          renderer.render(state);

          const visible = visibleSpan(output.view, viewport.width);
          const { shake, target } = output;
          write('frame', String(state.frame));
          write('scale', output.view.scale.toFixed(4));
          write('left', String(Math.round(visible.left)));
          write('right', String(Math.round(visible.right)));
          write('target-left', String(Math.round(target.left)));
          write('target-right', String(Math.round(target.right)));
          write('midpoint', String((state.fighters[0].x + state.fighters[1].x) / 2));
          write(
            'shake',
            shake.x === 0 && shake.y === 0 ? '0' : `${shake.x.toFixed(2)}, ${shake.y.toFixed(2)}`,
          );
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          unregister();
          renderer.destroy();
          actionsRef.current = null;
        };
      })
      .catch((cause: unknown) => {
        console.error(cause);
        setError(String(cause));
      });

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const act = (action: (actions: Actions) => void) => () => {
    const actions = actionsRef.current;
    if (actions) action(actions);
  };
  // Loading a scenario (or the same one again) always ends paused at frame 0.
  const reload = (action: (actions: Actions) => void) =>
    act((actions) => {
      action(actions);
      setPaused(true);
    });

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const readout = (label: string, key: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={`camera-${key}`} data-readout={key} />
    </>
  );

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Camera Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="camera-frame" data-readout="frame" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-400">
          Scenario{' '}
          <select
            aria-label="Scenario"
            className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            value={scenarioId}
            disabled={!ready}
            onChange={(event) => {
              const id = event.target.value;
              setScenarioId(id);
              reload((actions) => actions.choose(id))();
            }}
          >
            {SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          onClick={act((actions) => setPaused(actions.togglePause()))}
        >
          {paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready || !paused}
          onClick={act((actions) => actions.step())}
        >
          Step
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          onClick={reload((actions) => actions.reset())}
        >
          Reset
        </button>
        {TRIGGERS.map(({ type }) => (
          <button
            key={type}
            type="button"
            className={buttonClass}
            disabled={!ready}
            onClick={act((actions) => actions.trigger(type))}
          >
            Shake: {type}
          </button>
        ))}
        <label className="flex items-center gap-1 text-sm text-neutral-400">
          <input
            type="checkbox"
            defaultChecked
            onChange={(event) => act((actions) => actions.setOverlay(event.target.checked))()}
          />
          Overlays
        </label>
      </div>
      <div
        ref={hostRef}
        data-testid="arena"
        role="img"
        aria-label="Arena through the camera, with framing overlays"
        aria-describedby="camera-diagnostics"
        className="w-full max-w-[960px]"
      />
      <h2 id="camera-diagnostics" className="text-sm text-neutral-400">
        Diagnostics (world values in sub-units, 100 per world unit)
      </h2>
      <dl
        aria-labelledby="camera-diagnostics"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        {readout('Scale (px per world unit)', 'scale')}
        {readout('Visible left', 'left')}
        {readout('Visible right', 'right')}
        {readout('Target left', 'target-left')}
        {readout('Target right', 'target-right')}
        {readout('Fighter midpoint', 'midpoint')}
        <dt>Visual bounds left</dt>
        <dd data-testid="camera-bounds-left">{bounds.left}</dd>
        <dt>Visual bounds right</dt>
        <dd data-testid="camera-bounds-right">{bounds.right}</dd>
        {readout('Shake offset (px)', 'shake')}
      </dl>
      <p className="text-sm text-neutral-400">
        Scenarios play scripted input through production <code>step</code>; the camera turns each
        snapshot and its events into the renderer&apos;s view. Overlays: grey ground ticks every 100
        world units, yellow bars at the visual bounds, cyan bars at the edges of the frame the
        camera is converging to, a white line at the fighters&apos; midpoint. A shake trigger adds
        its event to the next tick, so while paused it shows on Step.
      </p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </section>
  );
}

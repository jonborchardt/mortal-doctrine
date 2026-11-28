import { useEffect, useRef, useState } from 'react';
import { createArenaRenderable, parseArena } from '@mortal-doctrine/arena';
import { PLACEHOLDER_ARENA } from '@mortal-doctrine/arena/testing';
import { createCamera, visibleSpan, type CameraConfig } from '@mortal-doctrine/camera';
import { FIXTURE_CAMERA_CONFIG } from '@mortal-doctrine/camera/testing';
import { createArenaRenderer, loadTextureManifest } from '@mortal-doctrine/renderer';
import { InputBit, type FrameInputs } from '@mortal-doctrine/sim-core';
import { createSimulationRunner } from '@mortal-doctrine/simulation';

const MANIFEST = '/fixtures/arena/manifest.json';
const ARENA = parseArena(PLACEHOLDER_ARENA);
// The arena supplies the visual bounds. No shake: a fighter reaching a wall must not move the view.
const CONFIG: CameraConfig = { ...FIXTURE_CAMERA_CONFIG, bounds: ARENA.visualBounds, shake: {} };
const { viewport } = CONFIG;

// Both fighters hold the same direction, so the camera pans with their midpoint.
const PANS = {
  left: { label: 'Left', inputs: [InputBit.LEFT, InputBit.LEFT] },
  hold: { label: 'Hold', inputs: [0, 0] },
  right: { label: 'Right', inputs: [InputBit.RIGHT, InputBit.RIGHT] },
} as const satisfies Record<string, { label: string; inputs: FrameInputs }>;
type Pan = keyof typeof PANS;

/** Control actions, created with the session inside the effect. */
interface Actions {
  /** Returns whether the runner is now paused. */
  togglePause(): boolean;
  step(): void;
  reset(): void;
  setPan(pan: Pan): void;
  setLayerVisible(layerId: string, visible: boolean): void;
}

export function ArenaLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  // Tail of the sessions so far: the manifest's URLs have one owner at a time, so a session
  // starts only after the previous one was torn down (StrictMode mounts twice).
  const sessions = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(true);
  const [pan, setPan] = useState<Pan>('hold');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    let disposed = false;
    let teardown = () => {};

    sessions.current = sessions.current
      .then(async () => {
        if (disposed) return;
        // No placeholder floor or fighters: the arena's ground layer is the only ground.
        const renderer = await createArenaRenderer(host, { ...viewport, placeholders: false });
        teardown = () => renderer.destroy();
        if (disposed) return teardown();
        const textures = await loadTextureManifest(MANIFEST);
        const arena = createArenaRenderable({
          arena: ARENA,
          textures,
          viewportWidth: viewport.width,
        });
        // On a renderer destroyed meanwhile this destroys the renderable, releasing the textures.
        renderer.register(arena);
        if (disposed) return;

        let inputs: FrameInputs;
        let runner: ReturnType<typeof createSimulationRunner>;
        let camera: ReturnType<typeof createCamera>;
        // A fresh, paused runner at frame 0, a camera with no history and no pan.
        const load = () => {
          runner = createSimulationRunner();
          runner.pause();
          camera = createCamera(CONFIG);
          inputs = PANS.hold.inputs;
        };
        load();

        actionsRef.current = {
          togglePause() {
            if (runner.paused) runner.resume();
            else runner.pause();
            return runner.paused;
          },
          step: () => void runner.stepOnce(() => inputs),
          reset: load,
          setPan(next) {
            inputs = PANS[next].inputs;
          },
          setLayerVisible: (layerId, visible) => arena.setLayerVisible(layerId, visible),
        };

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
          runner.advance(elapsedMs, () => inputs);
          const { state } = runner;
          const { view } = camera.update(state);
          // The view is set before the snapshot is drawn, so the arena never trails a frame.
          renderer.setView(view);
          renderer.render(state);

          const visible = visibleSpan(view, viewport.width);
          write('frame', String(state.frame));
          write('left', String(Math.round(visible.left)));
          write('right', String(Math.round(visible.right)));
          write('midpoint', String((state.fighters[0].x + state.fighters[1].x) / 2));
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          renderer.destroy();
          actionsRef.current = null;
        };
      })
      .catch((cause: unknown) => {
        console.error(cause);
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const act = (action: (actions: Actions) => void) => {
    const actions = actionsRef.current;
    if (actions) action(actions);
  };

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const readout = (label: string, key: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={`arena-${key}`} data-readout={key} />
    </>
  );

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Arena Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="arena-frame" data-readout="frame" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex items-center gap-2 text-sm text-neutral-400">
          <legend className="float-left pr-2">Pan</legend>
          {(Object.keys(PANS) as Pan[]).map((id) => (
            <label key={id} className="flex items-center gap-1">
              <input
                type="radio"
                name="arena-pan"
                checked={pan === id}
                disabled={!ready}
                onChange={() =>
                  act((actions) => {
                    actions.setPan(id);
                    setPan(id);
                  })
                }
              />
              {PANS[id].label}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          onClick={() => act((actions) => setPaused(actions.togglePause()))}
        >
          {paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready || !paused}
          onClick={() => act((actions) => actions.step())}
        >
          Step
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          onClick={() =>
            act((actions) => {
              actions.reset();
              setPaused(true);
              setPan('hold');
            })
          }
        >
          Reset
        </button>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
        <legend className="float-left pr-2">Layers (back to front)</legend>
        {ARENA.layers.map(({ id, parallax }) => (
          <label key={id} className="flex items-center gap-1">
            <input
              type="checkbox"
              defaultChecked
              disabled={!ready}
              onChange={(event) =>
                act((actions) => actions.setLayerVisible(id, event.target.checked))
              }
            />
            {id} (parallax {parallax})
          </label>
        ))}
      </fieldset>
      <div
        ref={hostRef}
        data-testid="arena"
        role="img"
        aria-label="Placeholder arena through the camera"
        aria-describedby="arena-diagnostics"
        className="w-full max-w-[960px]"
      />
      <h2 id="arena-diagnostics" className="text-sm text-neutral-400">
        Diagnostics (world values in sub-units, 100 per world unit)
      </h2>
      <dl
        aria-labelledby="arena-diagnostics"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        {readout('Visible left', 'left')}
        {readout('Visible right', 'right')}
        {readout('Fighter midpoint', 'midpoint')}
      </dl>
      <p className="text-sm text-neutral-400">
        The placeholder arena fixture drawn by the production arena renderable. Pan makes both
        fighters walk through production <code>step</code>; the production camera frames them and
        each layer follows by its parallax factor (0 is fixed on screen, 1 moves with the ground).
        Fighters are not drawn. While paused, Step advances one frame.
      </p>
      {error && <p className="text-red-400">Arena failed: {error}</p>}
    </section>
  );
}

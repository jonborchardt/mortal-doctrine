import { useEffect, useRef, useState } from 'react';
import { createKeyboardInput, type KeyboardInput } from '@mortal-doctrine/input';
import { createArenaRenderer } from '@mortal-doctrine/renderer';
import {
  createSimulationRunner,
  NEUTRAL_INPUT,
  TICK_RATE,
  type FrameInputs,
  type SimulationRunner,
} from '@mortal-doctrine/simulation';

interface Session {
  readonly runner: SimulationRunner;
  readonly keyboard: KeyboardInput;
}

type Readout = 'frame' | 'state' | 'fps' | 'tps' | 'simMs' | 'frameMs';

export function SimulationLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    let disposed = false;
    let teardown = () => {};

    createArenaRenderer(host)
      .then((renderer) => {
        if (disposed) return renderer.destroy();
        const runner = createSimulationRunner();
        const keyboard = createKeyboardInput(window);
        sessionRef.current = { runner, keyboard };
        const readouts = new Map(
          [...root.querySelectorAll<HTMLElement>('[data-readout]')].map((el) => [
            el.dataset.readout,
            el,
          ]),
        );
        const write = (key: Readout, text: string) => setText(readouts.get(key), text);

        // Measured tick rate over a rolling one-second window of display time.
        let windowMs = 0;
        let windowTicks = 0;

        // Per-frame work stays outside React; React only handles control clicks.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          const started = performance.now();
          const ticks = runner.advance(elapsedMs, inputsFrom(keyboard));
          const simMs = performance.now() - started;
          renderer.render(runner.state);

          windowMs += elapsedMs;
          windowTicks += ticks;
          if (windowMs >= 1000) {
            write('tps', String(Math.round((windowTicks * 1000) / windowMs)));
            windowMs = 0;
            windowTicks = 0;
          }
          write('frame', String(runner.state.frame));
          write('state', JSON.stringify(runner.state, null, 2));
          write('fps', Math.round(renderer.fps).toString());
          write('simMs', simMs.toFixed(3));
          write('frameMs', renderer.frameCpuMs.toFixed(2));
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          keyboard.dispose();
          renderer.destroy();
          sessionRef.current = null;
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
  const control = (action: (session: Session) => void) => {
    const session = sessionRef.current;
    if (!session) return;
    action(session);
    setPaused(session.runner.paused);
  };

  const togglePause = () =>
    control(({ runner }) => {
      if (runner.paused) runner.resume();
      else runner.pause();
    });
  const stepFrame = () => control(({ runner, keyboard }) => runner.stepOnce(inputsFrom(keyboard)));
  const reset = () => control(({ runner }) => runner.reset());

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Simulation Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="sim-frame" data-readout="frame" />
        </span>
      </header>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={!ready} onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready || !paused}
          onClick={stepFrame}
        >
          Step
        </button>
        <button type="button" className={buttonClass} disabled={!ready} onClick={reset}>
          Reset
        </button>
      </div>
      <dl
        aria-label="Diagnostics"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        <dt>Target tick rate</dt>
        <dd>{TICK_RATE} Hz</dd>
        <dt>Measured tick rate</dt>
        <dd data-testid="sim-tps" data-readout="tps" />
        <dt>Render FPS</dt>
        <dd data-testid="render-fps" data-readout="fps" />
        <dt>Simulation update (ms)</dt>
        <dd data-readout="simMs" />
        <dt>Frame CPU (ms)</dt>
        <dd data-readout="frameMs" />
      </dl>
      <div className="flex flex-wrap items-start gap-4">
        <div ref={hostRef} data-testid="arena" className="w-full max-w-[960px]" />
        <pre
          data-readout="state"
          data-testid="sim-state"
          aria-label="Simulation state"
          className="min-w-64 rounded bg-neutral-900 p-3 font-mono text-xs"
        />
      </div>
      <p className="text-sm text-neutral-500">Player 1: ← → or A / D. Step uses held keys.</p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </section>
  );
}

function inputsFrom(keyboard: KeyboardInput): FrameInputs {
  return [keyboard.read(), NEUTRAL_INPUT];
}

function setText(element: HTMLElement | null | undefined, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

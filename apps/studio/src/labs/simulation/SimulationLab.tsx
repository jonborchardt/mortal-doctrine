import { useEffect, useRef, useState } from 'react';
import {
  createInputCapture,
  DEFAULT_PLAYER_BINDINGS,
  type InputCapture,
} from '@mortal-doctrine/input';
import { createArenaRenderer } from '@mortal-doctrine/renderer';
import { InputBit, TICK_RATE, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import {
  createSimulationRunner,
  type InitialStateOptions,
  type SimulationEvent,
  type SimulationRunner,
} from '@mortal-doctrine/simulation';

// Deterministic fixture the lab starts from and Reset returns to.
const LAB_OPTIONS = { seed: 12345 } as const satisfies InitialStateOptions;
const HISTORY_SHOWN = 16;
const EVENTS_KEPT = 50;

interface Session {
  readonly runner: SimulationRunner;
  readonly players: readonly [InputCapture, InputCapture];
  /** Recent events, oldest first (shown newest first). Mutated by the loop and controls, never React state. */
  readonly log: SimulationEvent[];
}

type Readout = 'frame' | 'state' | 'fps' | 'tps' | 'simMs' | 'frameMs' | 'rng' | 'p1' | 'p2';

export function SimulationLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    const eventList = eventsRef.current;
    if (!host || !root || !eventList) return;
    let disposed = false;
    let teardown = () => {};

    createArenaRenderer(host)
      .then((renderer) => {
        if (disposed) return renderer.destroy();
        const runner = createSimulationRunner(LAB_OPTIONS);
        const players = [
          createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
          createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
        ] as const;
        const session: Session = { runner, players, log: [] };
        sessionRef.current = session;
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
        let shownLog = '';

        // Per-frame work stays outside React; React only handles control clicks.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          const started = performance.now();
          const { ticks, events } = runner.advance(elapsedMs, () => sample(players));
          const simMs = performance.now() - started;
          record(session, events);
          renderer.render(runner.state);

          windowMs += elapsedMs;
          windowTicks += ticks;
          if (windowMs >= 1000) {
            write('tps', String(Math.round((windowTicks * 1000) / windowMs)));
            windowMs = 0;
            windowTicks = 0;
          }
          const { state } = runner;
          write('frame', String(state.frame));
          write('state', formatState(state));
          write('rng', String(state.rng.state));
          write('p1', formatHistory(state.input.history[0]));
          write('p2', formatHistory(state.input.history[1]));
          write('fps', Math.round(renderer.fps).toString());
          write('simMs', simMs.toFixed(3));
          write('frameMs', renderer.frameCpuMs.toFixed(2));

          const logText = session.log.map(formatEvent).join('\n');
          if (logText !== shownLog) {
            shownLog = logText;
            eventList.replaceChildren(
              ...session.log.toReversed().map((event) => {
                const item = document.createElement('li');
                item.textContent = formatEvent(event);
                return item;
              }),
            );
          }
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          for (const player of players) player.dispose();
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
  const stepFrame = () =>
    control((session) =>
      record(
        session,
        session.runner.stepOnce(() => sample(session.players)),
      ),
    );
  const reset = () =>
    control(({ runner, log }) => {
      runner.reset();
      log.length = 0;
    });

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
      <h2 id="sim-diagnostics" className="text-sm text-neutral-400">
        Diagnostics
      </h2>
      <dl
        aria-labelledby="sim-diagnostics"
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
        <dt>Seed</dt>
        <dd data-testid="sim-seed">{LAB_OPTIONS.seed}</dd>
        <dt>RNG state (no draws yet)</dt>
        <dd data-testid="sim-rng" data-readout="rng" />
      </dl>
      <h2 id="sim-input-history" className="text-sm text-neutral-400">
        Input history
      </h2>
      <dl
        aria-labelledby="sim-input-history"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        <dt>P1 (last {HISTORY_SHOWN} frames, oldest → newest)</dt>
        <dd data-testid="input-history-p1" data-readout="p1" />
        <dt>P2 (last {HISTORY_SHOWN} frames, oldest → newest)</dt>
        <dd data-testid="input-history-p2" data-readout="p2" />
      </dl>
      <div className="flex flex-wrap items-start gap-4">
        <div ref={hostRef} data-testid="arena" className="w-full max-w-[960px]" />
        <pre
          data-readout="state"
          data-testid="sim-state"
          aria-label="Simulation state"
          className="min-w-64 max-w-full overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-xs"
        />
        <section
          aria-label="Event log"
          className="min-w-64 rounded bg-neutral-900 p-3 font-mono text-xs"
        >
          <h2 className="mb-1 text-neutral-400">Events (newest first, last {EVENTS_KEPT})</h2>
          <ol
            ref={eventsRef}
            data-testid="sim-events"
            className="max-h-96 space-y-0.5 overflow-y-auto"
          />
        </section>
      </div>
      <p className="text-sm text-neutral-400">
        Player 1: ← → or A / D (↑ ↓ or W / S and buttons U I O J K L are recorded only). Player 2:
        numpad 4 / 6 or the first gamepad. Step uses held keys plus any key tapped since the last
        tick.
      </p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </section>
  );
}

/** One sample per player per tick: held inputs plus presses latched since the previous tick. */
function sample(players: Session['players']): FrameInputs {
  return [players[0].sample(), players[1].sample()];
}

function record(session: Session, events: readonly SimulationEvent[]) {
  session.log.push(...events);
  session.log.splice(0, Math.max(0, session.log.length - EVENTS_KEPT));
}

const GLYPHS: readonly [number, string][] = [
  [InputBit.LEFT, '←'],
  [InputBit.RIGHT, '→'],
  [InputBit.UP, '↑'],
  [InputBit.DOWN, '↓'],
  [InputBit.A1, '1'],
  [InputBit.A2, '2'],
  [InputBit.A3, '3'],
  [InputBit.A4, '4'],
  [InputBit.A5, '5'],
  [InputBit.A6, '6'],
];

/** Raw frames as glyphs (opposing directions shown as recorded); `·` is neutral. */
function formatHistory(history: readonly InputFrame[]): string {
  return history
    .slice(-HISTORY_SHOWN)
    .map(
      (frame) =>
        GLYPHS.filter(([bit]) => frame & bit)
          .map(([, glyph]) => glyph)
          .join('') || '·',
    )
    .join(' ');
}

function formatEvent(event: SimulationEvent): string {
  return `frame ${event.frame}: ${event.type} P${event.player + 1} ${event.side}`;
}

/** Pretty JSON with number arrays (input history) kept on one line. */
function formatState(state: unknown): string {
  return JSON.stringify(state, null, 2).replace(/\[[\d\s,-]*\]/g, (array) =>
    array.replace(/\s+/g, ''),
  );
}

function setText(element: HTMLElement | null | undefined, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

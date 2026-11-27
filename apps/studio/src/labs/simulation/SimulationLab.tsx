import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  createInputCapture,
  DEFAULT_PLAYER_BINDINGS,
  type InputCapture,
} from '@mortal-doctrine/input';
import { startHostLoop, type HostLoop } from '@mortal-doctrine/renderer';
import { InputBit, TICK_RATE, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import type { InitialStateOptions, SimulationEvent } from '@mortal-doctrine/simulation';
import { createFixture, fixtureRecords, formatFixtureRecord } from './fixture-renderable';

// Deterministic fixture the lab starts from and Reset returns to.
const LAB_OPTIONS = { seed: 12345 } as const satisfies InitialStateOptions;
const HISTORY_SHOWN = 16;
const EVENTS_KEPT = 50;
const VIEWPORTS = { '960x540': [960, 540], '640x360': [640, 360] } as const;
type Viewport = keyof typeof VIEWPORTS;
const FIXTURE_LAYERS = ['off', 'effects', 'background'] as const;
type FixtureLayer = (typeof FIXTURE_LAYERS)[number];
const GAMEPLAY_KEYS = new Set(
  DEFAULT_PLAYER_BINDINGS.flatMap(({ keyboard }) => Object.values(keyboard ?? {}).flat()),
);

/**
 * Input is always live here, so a focused select must not turn gameplay keys (arrows, letter
 * type-ahead) into a value change. The key still reaches the window-level capture; Alt+Arrow, Tab,
 * Enter, Space and the mouse still change the select.
 */
function keepGameplayKeys(event: KeyboardEvent<HTMLSelectElement>) {
  if (!event.altKey && GAMEPLAY_KEYS.has(event.code)) event.preventDefault();
}

interface Session {
  readonly loop: HostLoop;
  readonly players: readonly [InputCapture, InputCapture];
  /** Recent events, oldest first (shown newest first). Mutated by the loop and controls, never React state. */
  readonly log: SimulationEvent[];
}

interface FixtureStatus {
  /** `generation:layer:resolution` of the load this result belongs to. */
  readonly key: string;
  readonly size?: string;
  readonly error?: string;
}

type Readout =
  | 'frame'
  | 'state'
  | 'fps'
  | 'tps'
  | 'simMs'
  | 'frameMs'
  | 'rng'
  | 'p1'
  | 'p2'
  | 'alpha'
  | 'fixtures';

export function SimulationLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const interpolateRef = useRef(false);
  // Increments each time a new loop is ready; the fixture effect re-registers on it.
  const [loopGeneration, setLoopGeneration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>('960x540');
  const [interpolate, setInterpolate] = useState(false);
  const [fixtureLayer, setFixtureLayer] = useState<FixtureLayer>('off');
  const [resolution, setResolution] = useState(2);
  // Result of the latest fixture load, keyed so a stale size or error is never shown.
  const [fixtureStatus, setFixtureStatus] = useState<FixtureStatus>({ key: '' });
  const ready = loopGeneration > 0;
  const fixtureKey = `${loopGeneration}:${fixtureLayer}:${resolution}`;
  const status = fixtureStatus.key === fixtureKey ? fixtureStatus : undefined;

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    const eventList = eventsRef.current;
    if (!host || !root || !eventList) return;
    let disposed = false;
    const players = [
      createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
      createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
    ] as const;
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
    const [width, height] = VIEWPORTS[viewport];

    // Per-frame work stays outside React; React only handles control clicks.
    const loop = startHostLoop(host, {
      inputs: () => sample(players),
      runner: LAB_OPTIONS,
      renderer: { width, height },
      interpolate: interpolateRef.current,
      onFrame: ({ elapsedMs, ticks, events, simMs, state }) => {
        record(session, events);
        windowMs += elapsedMs;
        windowTicks += ticks;
        if (windowMs >= 1000) {
          write('tps', String(Math.round((windowTicks * 1000) / windowMs)));
          windowMs = 0;
          windowTicks = 0;
        }
        write('frame', String(state.frame));
        write('state', formatState(state));
        write('rng', String(state.rng.state));
        write('p1', formatHistory(state.input.history[0]));
        write('p2', formatHistory(state.input.history[1]));
        write('fps', Math.round(loop.renderer?.fps ?? 0).toString());
        write('simMs', simMs.toFixed(3));
        write('frameMs', (loop.renderer?.frameCpuMs ?? 0).toFixed(2));
        write('alpha', loop.interpolate ? loop.runner.alpha.toFixed(3) : 'off');
        write('fixtures', fixtureRecords.map(formatFixtureRecord).join('\n'));

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
      },
    });
    const session: Session = { loop, players, log: [] };
    sessionRef.current = session;
    loop.ready
      .then(() => {
        if (disposed) return;
        setPaused(loop.runner.paused);
        setLoopGeneration((generation) => generation + 1);
      })
      .catch((cause: unknown) => {
        console.error(cause);
        setError(String(cause));
      });

    return () => {
      disposed = true;
      loop.destroy();
      for (const player of players) player.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [viewport]);

  // Lab-local renderable, registered through the renderer's public API in the chosen layer.
  useEffect(() => {
    const renderer = sessionRef.current?.loop.renderer;
    if (fixtureLayer === 'off' || !renderer) return;
    const key = `${loopGeneration}:${fixtureLayer}:${resolution}`;
    let cancelled = false;
    let unregister = () => {};
    createFixture(fixtureLayer, resolution).then(
      (fixture) => {
        if (cancelled) return fixture.renderable.destroy();
        fixtureRecords.push(fixture.record);
        unregister = renderer.register(fixture.renderable);
        setFixtureStatus({ key, size: fixture.size });
      },
      (cause: unknown) => {
        console.error(cause);
        if (!cancelled) {
          setFixtureStatus({ key, error: cause instanceof Error ? cause.message : String(cause) });
        }
      },
    );
    return () => {
      cancelled = true;
      unregister();
    };
  }, [loopGeneration, fixtureLayer, resolution]);

  // Event handlers only: refs must not be read during render.
  const control = (action: (session: Session) => void) => {
    const session = sessionRef.current;
    if (!session) return;
    action(session);
    setPaused(session.loop.runner.paused);
  };

  const togglePause = () =>
    control(({ loop: { runner } }) => {
      if (runner.paused) runner.resume();
      else runner.pause();
    });
  const stepFrame = () => control((session) => record(session, session.loop.stepOnce()));
  const reset = () =>
    control(({ loop: { runner }, log }) => {
      runner.reset();
      log.length = 0;
    });
  const toggleInterpolation = (checked: boolean) => {
    interpolateRef.current = checked;
    setInterpolate(checked);
    const session = sessionRef.current;
    if (session) session.loop.interpolate = checked;
  };

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
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Viewport
          <select
            className="rounded bg-neutral-800 px-2 py-1"
            value={viewport}
            aria-describedby="viewport-hint"
            onKeyDown={keepGameplayKeys}
            onChange={(event) => setViewport(event.target.value as Viewport)}
          >
            {Object.keys(VIEWPORTS).map((key) => (
              <option key={key} value={key}>
                {key.replace('x', '×')}
              </option>
            ))}
          </select>
        </label>
        <span id="viewport-hint" className="-ml-2 text-xs text-neutral-400">
          (changing it restarts the simulation)
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={interpolate}
            onChange={(event) => toggleInterpolation(event.target.checked)}
          />
          Interpolation
        </label>
        <span className="font-mono text-xs text-neutral-400">
          Alpha <span data-testid="render-alpha" data-readout="alpha" />
        </span>
        <label className="flex items-center gap-2">
          Fixture renderable
          <select
            className="rounded bg-neutral-800 px-2 py-1"
            value={fixtureLayer}
            onKeyDown={keepGameplayKeys}
            onChange={(event) => setFixtureLayer(event.target.value as FixtureLayer)}
          >
            {FIXTURE_LAYERS.map((layer) => (
              <option key={layer} value={layer}>
                {layer}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Texture resolution
          <select
            className="rounded bg-neutral-800 px-2 py-1"
            value={resolution}
            onKeyDown={keepGameplayKeys}
            onChange={(event) => setResolution(Number(event.target.value))}
          >
            <option value={2}>2×</option>
            <option value={1}>1×</option>
          </select>
        </label>
        <span className="font-mono text-xs text-neutral-400">
          Fixture size{' '}
          <span data-testid="fixture-size">
            {fixtureLayer === 'off'
              ? 'off'
              : (status?.size ?? (status?.error === undefined ? 'loading' : 'failed'))}
          </span>
        </span>
      </div>
      {fixtureLayer !== 'off' && status?.error !== undefined && (
        <p role="alert" data-testid="fixture-error" className="text-red-400">
          Fixture failed: {status.error}
        </p>
      )}
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
        <dt>Fixture renderables (this page)</dt>
        <dd>
          <pre data-testid="fixture-log" data-readout="fixtures" />
        </dd>
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
  return `frame ${event.frame}: ${event.type} P${event.player + 1} ${event.type === 'command' ? event.command : event.side}`;
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

import { useEffect, useRef, useState } from 'react';
import { COMMAND_SCRIPTS, GENERIC_COMMANDS } from '@mortal-doctrine/commands/testing';
import {
  createInputCapture,
  DEFAULT_PLAYER_BINDINGS,
  type InputCapture,
} from '@mortal-doctrine/input';
import {
  InputBit,
  resolveDirection,
  type FrameInputs,
  type InputFrame,
} from '@mortal-doctrine/sim-core';
import {
  createSimulationRunner,
  playerFacing,
  type SimulationEvent,
  type SimulationRunner,
} from '@mortal-doctrine/simulation';

const LIVE = 'live';
const FRAMES_SHOWN = 40;
const LOG_KEPT = 50;
const PLAYERS = [0, 1] as const;
const IDLE: FrameInputs = [0, 0];

interface Session {
  readonly runner: SimulationRunner;
  readonly players: readonly [InputCapture, InputCapture];
  /** A `COMMAND_SCRIPTS` id or `LIVE`. */
  source: string;
  /** Recognized commands, oldest first. Mutated by the loop and controls, never React state. */
  readonly log: string[];
  /** Bumped by every `load`, so the loop redraws even when the new run ends on the same frame. */
  loads: number;
}

export function CommandLab() {
  const rootRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLTableSectionElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [paused, setPaused] = useState(true);
  const [source, setSource] = useState(COMMAND_SCRIPTS[0]?.id ?? LIVE);

  useEffect(() => {
    const root = rootRef.current;
    const timeline = timelineRef.current;
    const logList = logRef.current;
    if (!root || !timeline || !logList) return;
    const session: Session = {
      runner: createSimulationRunner({ commands: GENERIC_COMMANDS }),
      players: [
        createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
        createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
      ],
      source: COMMAND_SCRIPTS[0]?.id ?? LIVE,
      log: [],
      loads: 0,
    };
    sessionRef.current = session;
    load(session);
    const { runner, log } = session;
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
    let last: number | undefined;
    let shownFrame = -1;
    let shownLoads = -1;
    let shownLog = '';
    let request = requestAnimationFrame(function loop(now) {
      const { events } = runner.advance(last === undefined ? 0 : now - last, (frame) =>
        provide(session, frame),
      );
      record(session, events);
      last = now;
      const { state } = runner;
      if (state.frame !== shownFrame || session.loads !== shownLoads) {
        shownFrame = state.frame;
        shownLoads = session.loads;
        write('frame', String(state.frame));
        const facing = playerFacing(state);
        for (const player of PLAYERS) write(`facing-${player}`, facing[player]);
        renderTimeline(timeline, state.frame, state.input.history);
      }
      const logText = log.join('\n');
      if (logText !== shownLog) {
        shownLog = logText;
        logList.replaceChildren(
          ...log.map((entry) => {
            const item = document.createElement('li');
            item.textContent = entry;
            return item;
          }),
        );
      }
      request = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(request);
      for (const player of session.players) player.dispose();
      sessionRef.current = null;
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const control = (action: (session: Session) => void) => {
    const session = sessionRef.current;
    if (!session) return;
    action(session);
    setPaused(session.runner.paused);
    setSource(session.source);
  };
  const togglePause = () =>
    control(({ runner }) => {
      if (runner.paused) runner.resume();
      else runner.pause();
    });
  const stepTick = () =>
    control((session) =>
      record(
        session,
        session.runner.stepOnce((f) => provide(session, f)),
      ),
    );
  const reset = () => control(load);
  const choose = (next: string) =>
    control((session) => {
      session.source = next;
      load(session);
    });

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Command Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="command-frame" data-readout="frame" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-400">
          Input source{' '}
          <select
            aria-label="Input source"
            className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            value={source}
            onChange={(event) => {
              // A focused select would take the arrow keys that drive player 1 and switch away
              // from live input.
              if (event.target.value === LIVE) event.target.blur();
              choose(event.target.value);
            }}
          >
            {COMMAND_SCRIPTS.map((script) => (
              <option key={script.id} value={script.id}>
                Fixture: {script.name}
              </option>
            ))}
            <option value={LIVE}>Live input (keyboard / gamepad)</option>
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className={buttonClass} disabled={!paused} onClick={stepTick}>
          Step
        </button>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
      </div>
      <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400">
        {PLAYERS.map((player) => (
          <div key={player} className="contents">
            <dt>Player {player + 1} facing (next tick)</dt>
            <dd data-testid={`command-facing-p${player + 1}`} data-readout={`facing-${player}`} />
          </div>
        ))}
      </dl>
      <section aria-label="Input timeline" className="overflow-x-auto">
        <h2 className="mb-1 text-sm text-neutral-400">
          Input timeline (last {FRAMES_SHOWN} frames of history; digits are buttons A1–A6)
        </h2>
        <table className="font-mono text-xs">
          <tbody ref={timelineRef} data-testid="command-timeline" />
        </table>
      </section>
      <section aria-label="Recognized commands" className="w-fit min-w-64 font-mono text-xs">
        <h2 className="mb-1 text-sm text-neutral-400">
          Recognized commands (oldest first, last {LOG_KEPT})
        </h2>
        <ol ref={logRef} data-testid="command-log" className="space-y-0.5" />
      </section>
      <details className="text-xs text-neutral-400">
        <summary>Command definitions (priority order)</summary>
        <pre>{GENERIC_COMMANDS.map((definition) => JSON.stringify(definition)).join('\n')}</pre>
      </details>
      <p className="text-sm text-neutral-400">
        Fixtures play player 1's input and its mirror for player 2 (who faces left). Live input:
        player 1 ← → ↑ ↓ or W A S D, buttons U I O J K L (A1–A6); player 2 numpad 4 6 8 5, buttons
        1–6. Pause, hold keys, then Step to enter a motion frame by frame.
      </p>
    </section>
  );
}

/** Rebuilds the initial state and, for a fixture, plays it to its end with production `step`. */
function load(session: Session) {
  const { runner, log } = session;
  runner.pause();
  runner.reset();
  log.length = 0;
  session.loads += 1;
  // Drop presses latched while the lab was not sampling.
  for (const player of session.players) player.sample();
  const script = scriptFor(session);
  if (!script) return;
  for (const inputs of script.inputs)
    record(
      session,
      runner.stepOnce(() => inputs),
    );
}

function provide(session: Session, frame: number): FrameInputs {
  if (session.source === LIVE) return [session.players[0].sample(), session.players[1].sample()];
  return scriptFor(session)?.inputs[frame] ?? IDLE;
}

function scriptFor(session: Session) {
  return COMMAND_SCRIPTS.find((script) => script.id === session.source);
}

function record(session: Session, events: readonly SimulationEvent[]) {
  for (const event of events) {
    if (event.type !== 'command') continue;
    session.log.push(`frame ${event.frame} · P${event.player + 1} · ${event.command}`);
  }
  if (session.log.length > LOG_KEPT) session.log.splice(0, session.log.length - LOG_KEPT);
}

const ARROWS = ['↙', '↓', '↘', '←', '·', '→', '↖', '↑', '↗'];
const BUTTONS = [InputBit.A1, InputBit.A2, InputBit.A3, InputBit.A4, InputBit.A5, InputBit.A6];

/** Raw frame as an arrow (opposing directions resolved by `resolveDirection`) plus button digits. */
function formatFrame(frame: InputFrame): string {
  const { x, y } = resolveDirection(frame);
  const buttons = BUTTONS.map((bit, index) => (frame & bit ? String(index + 1) : '')).join('');
  return `${ARROWS[(y + 1) * 3 + x + 1] ?? '?'}${buttons}`;
}

function renderTimeline(
  body: HTMLTableSectionElement,
  frame: number,
  history: readonly (readonly InputFrame[])[],
) {
  const shown = Math.min(FRAMES_SHOWN, history[0]?.length ?? 0);
  const first = frame - shown;
  const row = (label: string, cells: string[], header: boolean) => {
    const tr = document.createElement('tr');
    for (const text of [label, ...cells]) {
      const cell = document.createElement(header ? 'th' : 'td');
      cell.className = 'px-1 text-center';
      cell.textContent = text;
      tr.append(cell);
    }
    return tr;
  };
  body.replaceChildren(
    row(
      'frame',
      Array.from({ length: shown }, (_, i) => String(first + i)),
      true,
    ),
    ...PLAYERS.map((player) =>
      row(`P${player + 1}`, (history[player] ?? []).slice(-shown).map(formatFrame), false),
    ),
  );
}

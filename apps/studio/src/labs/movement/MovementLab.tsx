import { useEffect, useRef, useState } from 'react';
import { pushboxOf, type FighterState } from '@mortal-doctrine/movement';
import {
  MOVEMENT_SCENARIOS,
  PARAMETER_SETS,
  type MovementScenario,
  type ParameterSet,
} from '@mortal-doctrine/movement/testing';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import {
  createSimulationRunner,
  type SimulationEvent,
  type SimulationRunner,
} from '@mortal-doctrine/simulation';

const PLAYERS = [0, 1] as const;
const COLORS = ['#e0533d', '#3d8be0'] as const;
const LOG_KEPT = 50;
const TRACE_KEPT = 3600;
// View in world units, y up: ground at 0, room above for the highest jump.
const VIEW_HEIGHT = 300;
const VIEW_BELOW = 20;

interface Session {
  runner: SimulationRunner;
  scenario: MovementScenario;
  set: ParameterSet;
  /** Per player, the fighter's origin at every frame shown so far, in world units. */
  readonly trace: [string[], string[]];
  lastTraced: number;
  /** Event lines, oldest first. Mutated by the loop and controls, never React state. */
  readonly log: string[];
  /** Bumped by every load, so the loop redraws even when the frame number is unchanged. */
  loads: number;
}

const DEFAULT_SCENARIO = MOVEMENT_SCENARIOS[0] as MovementScenario;
const DEFAULT_SET = PARAMETER_SETS[0] as ParameterSet;

export function MovementLab() {
  const rootRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [paused, setPaused] = useState(true);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO.id);
  const [setId, setSetId] = useState(DEFAULT_SET.id);
  const [arenaWidth, setArenaWidth] = useState(96_000);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    const logList = logRef.current;
    if (!root || !svg || !logList) return;
    const session: Session = {
      runner: createSimulationRunner(),
      scenario: DEFAULT_SCENARIO,
      set: DEFAULT_SET,
      trace: [[], []],
      lastTraced: -1,
      log: [],
      loads: 0,
    };
    sessionRef.current = session;
    load(session);
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
    const boxes = PLAYERS.map((p) => svg.querySelector<SVGRectElement>(`[data-box="${p}"]`));
    const traces = PLAYERS.map((p) => svg.querySelector<SVGPolylineElement>(`[data-trace="${p}"]`));

    // Per-frame work stays outside React; React only handles control clicks.
    let last: number | undefined;
    let shownFrame = -1;
    let shownLoads = -1;
    let request = requestAnimationFrame(function loop(now) {
      const { runner } = session;
      const { events } = runner.advance(last === undefined ? 0 : now - last, (frame) =>
        provide(session, frame),
      );
      last = now;
      record(session, events);
      addTrace(session);
      const { state } = runner;
      if (state.frame !== shownFrame || session.loads !== shownLoads) {
        shownFrame = state.frame;
        shownLoads = session.loads;
        write('frame', String(state.frame));
        for (const player of PLAYERS) {
          const fighter = state.fighters[player];
          write(`p${player}-x`, String(fighter.x));
          write(`p${player}-y`, String(fighter.y));
          write(`p${player}-vx`, String(fighter.vx));
          write(`p${player}-vy`, String(fighter.vy));
          write(`p${player}-facing`, fighter.facing === 1 ? 'right' : 'left');
          write(`p${player}-state`, stance(fighter));
          drawBox(boxes[player], fighter);
          traces[player]?.setAttribute('points', session.trace[player].join(' '));
        }
        logList.replaceChildren(
          ...session.log.map((entry) => {
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
      sessionRef.current = null;
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const control = (action: (session: Session) => void) => {
    const session = sessionRef.current;
    if (!session) return;
    action(session);
    setPaused(session.runner.paused);
    setScenarioId(session.scenario.id);
    setSetId(session.set.id);
    setArenaWidth(session.runner.state.arena.width);
  };
  const togglePause = () =>
    control(({ runner }) => {
      if (runner.paused) runner.resume();
      else runner.pause();
    });
  const stepTick = () =>
    control((session) => {
      record(
        session,
        session.runner.stepOnce((frame) => provide(session, frame)),
      );
      addTrace(session);
    });
  const reset = () => control(load);
  const chooseScenario = (id: string) =>
    control((session) => {
      session.scenario = MOVEMENT_SCENARIOS.find((s) => s.id === id) ?? DEFAULT_SCENARIO;
      load(session);
    });
  const chooseSet = (id: string) =>
    control((session) => {
      session.set = PARAMETER_SETS.find((s) => s.id === id) ?? DEFAULT_SET;
      load(session);
    });

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const selectClass = 'rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100';
  const width = arenaWidth / SUBUNITS_PER_UNIT;

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Movement Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="movement-frame" data-readout="frame" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-400">
          Scenario{' '}
          <select
            aria-label="Scenario"
            className={selectClass}
            value={scenarioId}
            onChange={(event) => chooseScenario(event.target.value)}
          >
            {MOVEMENT_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-neutral-400">
          Parameters{' '}
          <select
            aria-label="Parameter set"
            className={selectClass}
            value={setId}
            onChange={(event) => chooseSet(event.target.value)}
          >
            {PARAMETER_SETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={togglePause}>
          {paused ? 'Play' : 'Pause'}
        </button>
        <button type="button" className={buttonClass} disabled={!paused} onClick={stepTick}>
          Step
        </button>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        data-testid="movement-view"
        role="img"
        aria-label="Arena with both fighters' pushboxes and trajectories"
        className="w-full max-w-[960px] rounded bg-neutral-900"
        viewBox={`0 ${-VIEW_HEIGHT} ${width} ${VIEW_HEIGHT + VIEW_BELOW}`}
      >
        <line x1={0} y1={0} x2={width} y2={0} stroke="#8a8398" strokeWidth={1} />
        <line x1={0} y1={-VIEW_HEIGHT} x2={0} y2={0} stroke="#8a8398" strokeWidth={2} />
        <line x1={width} y1={-VIEW_HEIGHT} x2={width} y2={0} stroke="#8a8398" strokeWidth={2} />
        {PLAYERS.map((player) => (
          <g key={player}>
            <polyline
              data-trace={player}
              fill="none"
              stroke={COLORS[player]}
              strokeOpacity={0.6}
              strokeWidth={1}
            />
            <rect
              data-box={player}
              fill={COLORS[player]}
              fillOpacity={0.35}
              stroke={COLORS[player]}
              strokeWidth={1}
            />
          </g>
        ))}
      </svg>
      <dl className="grid w-fit grid-cols-[auto_repeat(6,auto)] gap-x-4 font-mono text-xs text-neutral-400">
        <dt />
        {['x', 'y', 'vx', 'vy', 'facing', 'state'].map((label) => (
          <dd key={label}>{label}</dd>
        ))}
        {PLAYERS.map((player) => (
          <div key={player} className="contents">
            <dt style={{ color: COLORS[player] }}>Player {player + 1}</dt>
            {['x', 'y', 'vx', 'vy', 'facing', 'state'].map((field) => (
              <dd
                key={field}
                data-testid={`movement-p${player + 1}-${field}`}
                data-readout={`p${player}-${field}`}
              />
            ))}
          </div>
        ))}
      </dl>
      <section aria-label="Movement events" className="w-fit min-w-64 font-mono text-xs">
        <h2 className="mb-1 text-sm text-neutral-400">Events (oldest first, last {LOG_KEPT})</h2>
        <ol ref={logRef} data-testid="movement-events" className="space-y-0.5" />
      </section>
      <p className="text-sm text-neutral-400">
        Positions in sub-units (100 per world unit; y up, ground 0). Scenarios play player 1&apos;s
        scripted input through production <code>step</code>; boxes are the current pushboxes, lines
        the path of each fighter&apos;s origin (bottom centre).
      </p>
    </section>
  );
}

/** A fresh, paused runner for the session's scenario and parameter set at frame 0. */
function load(session: Session) {
  const { scenario, set } = session;
  session.runner = createSimulationRunner({
    movement: [set.params, set.params],
    ...(scenario.arena ? { arena: scenario.arena } : {}),
  });
  session.runner.pause();
  session.trace[0].length = 0;
  session.trace[1].length = 0;
  session.lastTraced = -1;
  session.log.length = 0;
  session.loads += 1;
  addTrace(session);
}

function provide(session: Session, frame: number) {
  // The runner still holds the state before this tick: trace it before it is replaced.
  addTrace(session);
  return session.scenario.inputs(frame);
}

function addTrace(session: Session) {
  const { state } = session.runner;
  if (state.frame <= session.lastTraced) return;
  session.lastTraced = state.frame;
  for (const player of PLAYERS) {
    const { x, y } = state.fighters[player];
    const points = session.trace[player];
    points.push(`${x / SUBUNITS_PER_UNIT},${-y / SUBUNITS_PER_UNIT}`);
    if (points.length > TRACE_KEPT) points.splice(0, points.length - TRACE_KEPT);
  }
}

function record(session: Session, events: readonly SimulationEvent[]) {
  for (const event of events) {
    const detail =
      event.type === 'wall-contact'
        ? ` ${event.side}`
        : event.type === 'command'
          ? ` ${event.command}`
          : '';
    session.log.push(`frame ${event.frame}: ${event.type} P${event.player + 1}${detail}`);
  }
  if (session.log.length > LOG_KEPT) session.log.splice(0, session.log.length - LOG_KEPT);
}

function stance(fighter: FighterState): string {
  if (!fighter.grounded) return 'airborne';
  return fighter.crouching ? 'crouching' : 'standing';
}

function drawBox(rect: SVGRectElement | null | undefined, fighter: FighterState) {
  if (!rect) return;
  const { width, height } = pushboxOf(fighter);
  rect.setAttribute('x', String((fighter.x - width / 2) / SUBUNITS_PER_UNIT));
  rect.setAttribute('y', String(-(fighter.y + height) / SUBUNITS_PER_UNIT));
  rect.setAttribute('width', String(width / SUBUNITS_PER_UNIT));
  rect.setAttribute('height', String(height / SUBUNITS_PER_UNIT));
}

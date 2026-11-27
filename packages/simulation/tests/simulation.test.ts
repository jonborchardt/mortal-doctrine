import { InputBit, TICK_MS, type FrameInputs } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import { updateFighters } from '../src/fighters';
import {
  ARENA_WIDTH,
  createInitialState,
  createSimulationRunner,
  DEFAULT_HISTORY_CAPACITY,
  deserializeState,
  FIGHTER_WIDTH,
  serializeState,
  simulationStateSchema,
  step,
  WALK_SPEED,
  type SimulationEvent,
  type SimulationState,
} from '../src/index';
import { initialRng, updateRng } from '../src/rng';
import {
  held,
  IDLE,
  P1_LEFT,
  P1_RIGHT,
  runFrames,
  SEEDED_OPTIONS,
  walkCycleScript,
} from '../src/testing';

const { LEFT, RIGHT, UP, DOWN, A1, A6 } = InputBit;
const constant = (inputs: FrameInputs) => () => inputs;

/** Replaces the value at `path` in a JSON copy of `state`. */
function withValue(state: SimulationState, path: (string | number)[], value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(state)) as Record<string | number, unknown>;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path.at(-1) as string | number] = value;
  return copy;
}

function serialized(state: unknown, schemaVersion: unknown = 1): string {
  return JSON.stringify({ schemaVersion, state });
}

function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(numbersIn);
  return [];
}

describe('simulation', () => {
  it('runs headlessly and moves player one by walk speed per tick', () => {
    const { state, events } = step(createInitialState(), P1_RIGHT);
    expect(state.frame).toBe(1);
    expect(state.fighters[0].x).toBe(createInitialState().fighters[0].x + WALK_SPEED);
    expect(state.fighters[1]).toEqual(createInitialState().fighters[1]);
    expect(events).toEqual([]);
  });

  it('uses sub-units: same on-screen positions and speed as before', () => {
    expect(createInitialState().fighters).toEqual([{ x: 24_000 }, { x: 72_000 }]);
    expect([ARENA_WIDTH, FIGHTER_WIDTH, WALK_SPEED]).toEqual([96_000, 6_000, 400]);
  });

  it('keeps fighters inside the arena', () => {
    const left = runFrames(createInitialState(), constant(P1_LEFT), 1000).state;
    const right = runFrames(createInitialState(), constant(P1_RIGHT), 1000).state;
    expect(left.fighters[0].x).toBe(FIGHTER_WIDTH / 2);
    expect(right.fighters[0].x).toBe(ARENA_WIDTH - FIGHTER_WIDTH / 2);
  });

  it('walks by the resolved direction: left + right does not move, buttons are ignored', () => {
    const start = createInitialState();
    const { state } = step(start, [held(LEFT, RIGHT), held(RIGHT, UP, DOWN, A1, A6)]);
    expect(state.fighters[0].x).toBe(start.fighters[0].x);
    expect(state.fighters[1].x).toBe(start.fighters[1].x + WALK_SPEED);
  });
});

describe('step input validation', () => {
  const state = createInitialState();
  const invalid: [string, unknown][] = [
    ['a missing player', [0]],
    ['an extra player', [0, 0, 0]],
    ['undefined', undefined],
    ['an undefined player frame', [0, undefined]],
    ['a bit above bit 9', [1 << 10, 0]],
    ['a negative frame', [0, -1]],
    ['a non-integer frame', [1.5, 0]],
  ];
  it.each(invalid)('throws on %s', (_, inputs) => {
    expect(() => step(state, inputs as FrameInputs)).toThrow(/Invalid FrameInputs/);
  });
});

describe('int32 state', () => {
  const state = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 20).state;
  const positions: [string, (string | number)[]][] = [
    ['frame', ['frame']],
    ['rng', ['rng', 'state']],
    ['capacity', ['input', 'capacity']],
    ['history', ['input', 'history', 0, 0]],
    ['fighter x', ['fighters', 1, 'x']],
  ];

  it.each(positions)('rejects a float and out-of-range values in %s', (_, path) => {
    expect(simulationStateSchema.safeParse(withValue(state, path, 8)).success).toBe(true);
    for (const bad of [1.5, 2_147_483_648, -2_147_483_649]) {
      expect(simulationStateSchema.safeParse(withValue(state, path, bad)).success).toBe(false);
      expect(() => deserializeState(serialized(withValue(state, path, bad)))).toThrow(
        `state.${path.join('.')}`,
      );
    }
  });

  it('holds only int32 integers after a 3,600-frame scripted run', () => {
    const { state: end } = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 3600);
    const numbers = numbersIn(end);
    expect(numbers.length).toBeGreaterThan(10);
    for (const n of numbers) {
      expect(Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647).toBe(true);
    }
    expect(end.rng.state).toBe(-1_640_531_527); // 0x9e3779b9 as int32
  });
});

describe('input history', () => {
  it('stores raw frames, oldest first, with a default capacity of 60', () => {
    const initial = createInitialState();
    expect(initial.input).toEqual({ capacity: DEFAULT_HISTORY_CAPACITY, history: [[], []] });
    expect(DEFAULT_HISTORY_CAPACITY).toBe(60);
    let state = initial;
    const frames = [held(LEFT, RIGHT), held(UP, DOWN), A1, 0];
    for (const frame of frames) state = step(state, [frame, A6]).state;
    expect(state.input.history[0]).toEqual(frames);
    expect(state.input.history[1]).toEqual([A6, A6, A6, A6]);
  });

  it('honours a non-default capacity and drops the oldest frame when full', () => {
    let state = createInitialState({ historyCapacity: 3 });
    for (let frame = 1; frame <= 5; frame++) state = step(state, [frame, 0]).state;
    expect(state.input.history[0]).toEqual([3, 4, 5]);
    const long = runFrames(createInitialState(), walkCycleScript, 100).state;
    expect(long.input.history[0]).toHaveLength(60);
    expect(long.input.history[1]).toEqual(
      Array.from({ length: 60 }, (_, i) => walkCycleScript(40 + i)[1]),
    );
  });

  it('rejects an invalid capacity', () => {
    for (const bad of [0, 601, 1.5]) {
      expect(() => createInitialState({ historyCapacity: bad })).toThrow(/historyCapacity/);
    }
  });

  it('already contains the current frame when the walk phase runs', () => {
    // Walk reads the current frame from history: moving on the very first tick proves the
    // history phase ran first.
    expect(step(createInitialState(), P1_RIGHT).state.fighters[0].x).toBe(24_400);
    const fighters = createInitialState().fighters;
    const moved = updateFighters(fighters, {
      frame: 0,
      inputs: IDLE,
      input: { capacity: 60, history: [[RIGHT], [LEFT]] },
    });
    expect(moved.slice).toEqual([{ x: 24_400 }, { x: 71_600 }]);
    expect(() =>
      updateFighters(fighters, { frame: 0, inputs: IDLE, input: createInitialState().input }),
    ).toThrow(/before input history/);
  });

  it('round-trips exactly through serialization', () => {
    const state = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 77).state;
    expect(state.input.history[0]).toHaveLength(8);
    expect(deserializeState(serializeState(state)).input).toEqual(state.input);
  });
});

describe('rng slice', () => {
  it('is seeded through the options and left unchanged by step', () => {
    const initial = createInitialState(SEEDED_OPTIONS);
    expect(initial.rng).toEqual(initialRng(SEEDED_OPTIONS.seed));
    expect(createInitialState().rng).toEqual({ state: 0 });
    const { state } = runFrames(initial, walkCycleScript, 500);
    expect(state.rng).toEqual(initial.rng);
    expect(updateRng(initial.rng, { frame: 0 })).toEqual({ slice: initial.rng, events: [] });
    expect(() => createInitialState({ seed: -1 })).toThrow(/RNG seed/);
  });
});

describe('events', () => {
  it('returns both same-tick boundary contacts in player order, stamped with the processed frame', () => {
    let state = createInitialState();
    const seen: SimulationEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const result = step(state, [LEFT, RIGHT]);
      seen.push(...result.events);
      state = result.state;
    }
    expect(seen).toEqual([
      { type: 'boundary-contact', frame: 52, player: 0, side: 'left' },
      { type: 'boundary-contact', frame: 52, player: 1, side: 'right' },
    ]);
  });

  it('emits once per contact, not while a fighter stays at the edge', () => {
    const { events } = runFrames(createInitialState(), walkCycleScript, 3600);
    expect(events.length).toBe(40); // player two reaches the right edge once per 90-frame cycle
    expect(events.every((e) => e.player === 1 && e.side === 'right')).toBe(true);
    expect(events[0]?.frame).toBe(52);
    expect(events[1]?.frame).toBe(90 + 19);
  });

  it('returns a new frozen array every step that consumers cannot use to affect the simulation', () => {
    const atEdge = runFrames(createInitialState(), constant([LEFT, RIGHT]), 52).state;
    const first = step(atEdge, [LEFT, RIGHT]);
    const second = step(atEdge, [LEFT, RIGHT]);
    expect(first.events).not.toBe(second.events);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(first.events.every((event) => Object.isFrozen(event))).toBe(true);
    expect(Object.isFrozen(step(atEdge, IDLE).events)).toBe(true);

    const reference = serializeState(runFrames(first.state, walkCycleScript, 200).state);
    const mutableEvents = first.events as SimulationEvent[];
    expect(() => mutableEvents.push(first.events[0] as SimulationEvent)).toThrow(TypeError);
    expect(() => {
      (first.events[0] as { frame: number }).frame = 0;
    }).toThrow(TypeError);
    expect(first.events[0]?.frame).toBe(52);
    expect(serializeState(runFrames(first.state, walkCycleScript, 200).state)).toBe(reference);
  });
});

describe('determinism', () => {
  it('produces identical state and events from identical options and inputs over 3,600 frames', () => {
    const a = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 3600);
    const b = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 3600);
    expect(a.state.frame).toBe(3600);
    expect(serializeState(a.state)).toBe(serializeState(b.state));
    expect(a.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('serializes mid-run and resumes to match an uninterrupted run in state and events', () => {
    const uninterrupted = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 3600);
    const firstHalf = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 1777);
    const restored = deserializeState(serializeState(firstHalf.state));
    expect(restored).toEqual(firstHalf.state);
    const secondHalf = runFrames(restored, walkCycleScript, 3600 - 1777);
    expect(serializeState(secondHalf.state)).toBe(serializeState(uninterrupted.state));
    expect([...firstHalf.events, ...secondHalf.events]).toEqual(uninterrupted.events);
  });

  it('does not mutate the input state', () => {
    const initial = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 30).state;
    const snapshot = serializeState(initial);
    step(initial, P1_RIGHT);
    step(initial, [LEFT, RIGHT]);
    expect(serializeState(initial)).toBe(snapshot);
  });
});

describe('serialization', () => {
  const state = runFrames(createInitialState(SEEDED_OPTIONS), walkCycleScript, 10).state;

  it('writes { schemaVersion: 1, state }', () => {
    expect(JSON.parse(serializeState(state))).toEqual({ schemaVersion: 1, state });
  });

  it('rejects an unsupported version, naming found and supported versions', () => {
    expect(() => deserializeState(serialized(state, 2))).toThrow(
      'Unsupported simulation state schemaVersion 2; supported: 1',
    );
    expect(() => deserializeState(JSON.stringify({ state }))).toThrow(
      'schemaVersion undefined; supported: 1',
    );
  });

  const cases: [string, unknown, string][] = [
    ['a float', withValue(state, ['fighters', 0, 'x'], 1.5), 'state.fighters.0.x'],
    ['an out-of-range value', withValue(state, ['frame'], 2 ** 31), 'state.frame'],
    [
      'a bad bitmask',
      withValue(state, ['input', 'history', 1, 2], 1024),
      'state.input.history.1.2',
    ],
    [
      'a wrong player count',
      withValue(state, ['fighters'], [{ x: 1 }, { x: 2 }, { x: 3 }]),
      'state.fighters',
    ],
    [
      'a history longer than capacity',
      withValue(state, ['input', 'capacity'], 4),
      'state.input.history.0: holds 8 frames, more than capacity 4',
    ],
  ];
  it.each(cases)('rejects %s, naming the failing path', (_, bad, path) => {
    let restored: SimulationState | undefined;
    expect(() => {
      restored = deserializeState(serialized(bad));
    }).toThrow(path);
    expect(restored).toBeUndefined();
  });
});

describe('simulation runner', () => {
  it('calls the provider once per tick with consecutive frames, recording each in history', () => {
    const runner = createSimulationRunner();
    const asked: number[] = [];
    const frames = [LEFT, held(LEFT, RIGHT), A1, UP, 0];
    const provider = (frame: number): FrameInputs => {
      asked.push(frame);
      return [frames[frame] ?? 0, 0];
    };
    expect(runner.advance(TICK_MS * 3, provider).ticks).toBe(3);
    runner.stepOnce(provider);
    expect(runner.advance(TICK_MS, provider).ticks).toBe(1);
    expect(asked).toEqual([0, 1, 2, 3, 4]);
    expect(runner.state.input.history[0]).toEqual(frames);
  });

  it('runs one tick per whole tick interval of elapsed time', () => {
    const runner = createSimulationRunner();
    expect(runner.advance(TICK_MS * 3, constant(IDLE))).toEqual({ ticks: 3, events: [] });
    expect(runner.advance(TICK_MS / 2, constant(IDLE)).ticks).toBe(0);
    expect(runner.advance(TICK_MS / 2, constant(IDLE)).ticks).toBe(1);
    expect(runner.state.frame).toBe(4);
  });

  it('caps catch-up after a long stall', () => {
    const runner = createSimulationRunner();
    expect(runner.advance(60_000, constant(IDLE)).ticks).toBe(15);
  });

  it('returns the events of every tick run, in tick order', () => {
    const runner = createSimulationRunner();
    // Player one reaches the left edge on frame 52; player two starts walking on frame 5 and
    // reaches the right edge on frame 57.
    const provider = (frame: number): FrameInputs => [LEFT, frame >= 5 ? RIGHT : 0];
    const batches = [0, 1, 2, 3].map(() => runner.advance(250, provider));
    expect(batches.map((b) => b.ticks)).toEqual([15, 15, 15, 15]);
    expect(batches.slice(0, 3).every((b) => b.events.length === 0)).toBe(true);
    expect(batches[3]?.events).toEqual([
      { type: 'boundary-contact', frame: 52, player: 0, side: 'left' },
      { type: 'boundary-contact', frame: 57, player: 1, side: 'right' },
    ]);
  });

  it('returns the events of a single step', () => {
    const runner = createSimulationRunner();
    for (let i = 0; i < 52; i++) expect(runner.stepOnce(constant(P1_LEFT))).toEqual([]);
    expect(runner.stepOnce(constant(P1_LEFT))).toEqual([
      { type: 'boundary-contact', frame: 52, player: 0, side: 'left' },
    ]);
  });

  it('pauses without calling the provider, single-steps, resumes and resets', () => {
    const runner = createSimulationRunner(SEEDED_OPTIONS);
    runner.advance(TICK_MS * 2, constant(IDLE));
    runner.pause();
    let calls = 0;
    const counting = () => {
      calls++;
      return P1_RIGHT;
    };
    expect(runner.advance(TICK_MS * 5, counting)).toEqual({ ticks: 0, events: [] });
    expect(calls).toBe(0);
    runner.stepOnce(counting);
    expect(calls).toBe(1);
    expect(runner.state.frame).toBe(3);
    runner.reset();
    expect(runner.paused).toBe(true);
    expect(runner.state).toEqual(createInitialState(SEEDED_OPTIONS));
    expect(runner.state.input.capacity).toBe(8);
    runner.resume();
    expect(runner.advance(TICK_MS, constant(IDLE)).ticks).toBe(1);
  });
});

// Movement through `step`: facing, bounds, pushboxes, separation limit, events, symmetry,
// determinism and validation (the per-tick kinematics tables live in packages/movement).
import {
  DEFAULT_MOVEMENT_PARAMETERS,
  pushboxOf,
  type FighterState,
  type MovementParameters,
} from '@mortal-doctrine/movement';
import {
  MOVEMENT_SCENARIOS,
  mirrorEvent,
  mirrorInputs,
  mirrorSlice,
  RAMPED_MOVEMENT_PARAMETERS,
  type MovementScenario,
} from '@mortal-doctrine/movement/testing';
import { InputBit, type FrameInputs } from '@mortal-doctrine/sim-core';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  deserializeState,
  serializeState,
  step,
  type InitialStateOptions,
  type SimulationEvent,
  type SimulationState,
} from '../src/index';
import type { InputProvider } from '../src/runner';

const { LEFT, RIGHT, UP, DOWN, A1 } = InputBit;
const SETS: [string, MovementParameters][] = [
  ['default', DEFAULT_MOVEMENT_PARAMETERS],
  ['ramped', RAMPED_MOVEMENT_PARAMETERS],
];

interface Tick {
  readonly state: SimulationState;
  readonly events: readonly SimulationEvent[];
}

/** The state and events after every tick. */
function trace(state: SimulationState, script: InputProvider, count: number): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i < count; i++) {
    const result = step(state, script(state.frame));
    state = result.state;
    ticks.push(result);
  }
  return ticks;
}

const scenario = (id: string): MovementScenario => {
  const found = MOVEMENT_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
};

function scenarioOptions(s: MovementScenario, params: MovementParameters): InitialStateOptions {
  return { movement: [params, params], ...(s.arena ? { arena: s.arena } : {}) };
}

function runScenario(id: string, params = DEFAULT_MOVEMENT_PARAMETERS, count?: number) {
  const s = scenario(id);
  return trace(createInitialState(scenarioOptions(s, params)), s.inputs, count ?? s.frames);
}

/** The state with the fighters replaced, e.g. to start a named case mid-arena. */
function placed(
  options: InitialStateOptions,
  ...changes: [Partial<FighterState>, Partial<FighterState>]
): SimulationState {
  const initial = createInitialState(options);
  return {
    ...initial,
    fighters: [
      { ...initial.fighters[0], ...changes[0] },
      { ...initial.fighters[1], ...changes[1] },
    ],
  };
}

const halfWidth = (fighter: FighterState) => pushboxOf(fighter).width / 2;

/** The rule-5 overlap test: both axes, touching edges are not overlap. */
function overlapping(a: FighterState, b: FighterState): boolean {
  const boxA = pushboxOf(a);
  const boxB = pushboxOf(b);
  return (
    Math.abs(a.x - b.x) < (boxA.width + boxB.width) / 2 &&
    a.y < b.y + boxB.height &&
    b.y < a.y + boxA.height
  );
}

function expectInBoundsAndApart(ticks: readonly Tick[]) {
  for (const { state } of ticks) {
    const [a, b] = state.fighters;
    for (const f of [a, b]) {
      expect(f.x - halfWidth(f)).toBeGreaterThanOrEqual(0);
      expect(f.x + halfWidth(f)).toBeLessThanOrEqual(state.arena.width);
    }
    expect(overlapping(a, b), `frame ${state.frame}`).toBe(false);
  }
}

const sign = (n: number) => (n > 0 ? 1 : -1);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(numbersIn);
  return [];
}

/** Walks, crouches, jumps, collides and hits walls, repeating every 360 / 240 frames. */
const MIXED_SCRIPT: InputProvider = (frame) => {
  const a = frame % 360;
  const b = frame % 240;
  const p1 =
    a < 150
      ? RIGHT
      : a === 150
        ? UP | RIGHT
        : a < 190
          ? 0
          : a < 220
            ? DOWN
            : a < 330
              ? LEFT
              : a < 345
                ? UP
                : DOWN | RIGHT;
  const p2 =
    b < 100 ? LEFT : b < 110 ? UP | LEFT : b < 160 ? RIGHT : b < 200 ? DOWN | A1 : UP | RIGHT;
  return [p1, p2];
};

describe('facing', () => {
  it('grounded fighters face each other on every frame of scripted runs', () => {
    for (const [, params] of SETS) {
      const ticks = [
        ...trace(createInitialState({ movement: [params, params] }), MIXED_SCRIPT, 1200),
        ...runScenario('cross-up', params),
        ...runScenario('corner-push', params),
      ];
      let checked = 0;
      for (const { state } of ticks) {
        const [a, b] = state.fighters;
        for (const [own, other] of [
          [a, b],
          [b, a],
        ] as const) {
          if (!own.grounded || own.x === other.x) continue;
          expect(own.facing).toBe(sign(other.x - own.x));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(2000);
    }
  });

  it('keeps an airborne fighter’s facing from take-off until the landing tick', () => {
    for (const [, params] of SETS) {
      const ticks = trace(createInitialState({ movement: [params, params] }), MIXED_SCRIPT, 1200);
      let airborne = 0;
      for (let i = 1; i < ticks.length; i++) {
        for (const player of [0, 1] as const) {
          const before = ticks[i - 1]?.state.fighters[player];
          const now = ticks[i]?.state.fighters[player];
          if (before && now && !before.grounded && !now.grounded) {
            expect(now.facing).toBe(before.facing);
            airborne++;
          }
        }
      }
      expect(airborne).toBeGreaterThan(100);
    }
  });

  it('turns both fighters to face each other on the landing tick of a cross-up', () => {
    // Player 1 walks 97 ticks to x 62800, then forward-jumps at 500 per tick over player 2
    // (x 72000): x-overlap only on airborne ticks 9-28, all at y ≥ 12000 (the standing top).
    const ticks = runScenario('cross-up');
    const landing = ticks.findIndex(({ events }) => events.some((e) => e.type === 'land'));
    expect(landing).toBe(136);
    const before = ticks[landing - 1]?.state.fighters;
    const after = ticks[landing]?.state.fighters;
    expect(before?.[0]).toMatchObject({ x: 82_300, grounded: false, facing: 1 });
    expect(before?.[1]).toMatchObject({ x: 72_000, facing: 1 }); // turned while grounded
    expect(after?.[0]).toMatchObject({ x: 82_800, y: 0, grounded: true, facing: -1 });
    expect(after?.[1]).toMatchObject({ x: 72_000, facing: 1 });
    // Player 2 turns on the first tick player 1 is right of it (airborne tick 19, frame 115).
    expect(ticks[114]?.state.fighters[1].facing).toBe(-1);
    expect(ticks[115]?.state.fighters[1].facing).toBe(1);
  });
});

describe('walls and pushboxes', () => {
  it('keeps pushboxes inside the arena and apart on every frame of long runs', () => {
    for (const [, params] of SETS) {
      const movement = [params, params] as const;
      const runs = [
        // Both corners.
        trace(createInitialState({ movement }), () => [LEFT, RIGHT], 400),
        // A fighter pushed into a corner, both directions.
        runScenario('corner-push', params, 400),
        trace(createInitialState({ movement }), () => [0, LEFT], 400),
        // Walking into each other.
        trace(createInitialState({ movement }), () => [RIGHT, LEFT], 400),
        // A jump landing on the opponent.
        trace(placed({ movement }, { x: 52_000 }, {}), (f) => [f === 0 ? UP | RIGHT : 0, 0], 120),
        // Cross-ups, in the open and over a cornered opponent.
        runScenario('cross-up', params),
        trace(
          placed({ movement }, { x: 84_000 }, { x: 93_000 }),
          (f) => [f === 0 ? UP | RIGHT : 0, 0],
          120,
        ),
        trace(createInitialState({ movement }), MIXED_SCRIPT, 3600),
      ];
      for (const run of runs) expectInBoundsAndApart(run);
    }
  });

  it('does not push a jumper above the opponent’s pushbox top (cross-up)', () => {
    const ticks = runScenario('cross-up');
    let above = 0;
    for (let n = 1; n <= 40; n++) {
      const [p1, p2] = ticks[96 + n]?.state.fighters ?? [];
      expect(p1?.x).toBe(62_800 + 500 * n);
      expect(p2?.x).toBe(72_000);
      if (p1 && p2 && Math.abs(p1.x - p2.x) < 5000) {
        expect(p1.y).toBeGreaterThanOrEqual(p2.y + pushboxOf(p2).height);
        above++;
      }
    }
    expect(above).toBe(20); // airborne ticks 9-28
  });

  it('corner push: the pusher stops one standing width from the cornered fighter', () => {
    // Contact at tick 105 (x 66000 / 72000); then each tick the 400 overlap splits 200 / 200
    // until player 2 reaches the wall (x 93000) on tick 210; player 1 then takes the whole push.
    const ticks = runScenario('corner-push');
    expect(ticks[104]?.state.fighters.map((f) => f.x)).toEqual([66_000, 72_000]);
    expect(ticks[105]?.state.fighters.map((f) => f.x)).toEqual([66_200, 72_200]);
    expect(ticks[209]?.state.fighters.map((f) => f.x)).toEqual([87_000, 93_000]);
    const end = ticks.at(-1)?.state.fighters;
    expect(end?.map((f) => [f.x, f.vx])).toEqual([
      [87_000, 400],
      [93_000, 0],
    ]);
    expect(ticks.flatMap((t) => t.events)).toEqual([
      { type: 'wall-contact', frame: 209, player: 1, side: 'right' },
    ]);
  });

  it('cross-up over a cornered opponent: the jumper lands in the corner', () => {
    // From x 84000, player 1 jumps over player 2 (x 93000, cornered), reaches the wall
    // (airborne x 94000) on tick 20 and is held there with vx 0 from tick 21, overlaps on tick 33 (y 11550) and pushes player 2 out by
    // 4000; landing widens its box, so it moves to 93000 and pushes player 2 another 2000.
    const start = placed({}, { x: 84_000 }, { x: 93_000 });
    const ticks = trace(start, (f) => [f === 0 ? UP | RIGHT : 0, 0], 41);
    expect(ticks[19]?.state.fighters[0]).toMatchObject({ x: 94_000, vx: 500, y: 20_000 });
    expect(ticks[20]?.state.fighters[0]).toMatchObject({ x: 94_000, vx: 0, y: 19_950 });
    expect(ticks[32]?.state.fighters.map((f) => [f.x, f.y])).toEqual([
      [94_000, 11_550],
      [89_000, 0],
    ]);
    const landed = ticks[39]?.state.fighters;
    expect(landed?.map((f) => [f.x, f.y, f.grounded, f.facing])).toEqual([
      [93_000, 0, true, -1],
      [87_000, 0, true, 1],
    ]);
    expect(ticks.flatMap((t) => t.events)).toEqual([
      { type: 'jump', frame: 0, player: 0 },
      { type: 'wall-contact', frame: 19, player: 0, side: 'right' },
      { type: 'land', frame: 39, player: 0 },
    ]);
  });
});

describe('max separation', () => {
  it('never lets |x0 − x1| exceed the limit and emits no event of its own', () => {
    for (const [, params] of SETS) {
      const ticks = runScenario('max-separation', params);
      for (const { state } of ticks) {
        expect(Math.abs(state.fighters[0].x - state.fighters[1].x)).toBeLessThanOrEqual(60_000);
      }
      expect(ticks.flatMap((t) => t.events).map((e) => e.type)).toEqual(['jump', 'land']);
    }
  });

  it('one walking back while the other stands: the stander does not move', () => {
    const ticks = runScenario('max-separation');
    expect(ticks[29]?.state.fighters.map((f) => [f.x, f.vx])).toEqual([
      [12_000, -400],
      [72_000, 0],
    ]);
    for (const { state } of ticks.slice(30, 50)) {
      expect(state.fighters.map((f) => [f.x, f.vx])).toEqual([
        [12_000, 0],
        [72_000, 0],
      ]);
    }
  });

  it('both walking back: each takes half of the excess back', () => {
    // 48000 apart, each walks back 400 per tick: exactly 60000 apart after tick 15; on tick 16
    // the 800 excess is split 400 / 400.
    const options = { arena: { width: 96_000, maxSeparation: 60_000 } };
    const ticks = trace(createInitialState(options), () => [LEFT, RIGHT], 30);
    expect(ticks[14]?.state.fighters.map((f) => [f.x, f.vx])).toEqual([
      [18_000, -400],
      [78_000, 400],
    ]);
    for (const { state } of ticks.slice(15)) {
      expect(state.fighters.map((f) => [f.x, f.vx])).toEqual([
        [18_000, 0],
        [78_000, 0],
      ]);
    }
    // The scenario's both-walk-back phase starts at the limit and holds both in place.
    for (const { state } of runScenario('max-separation').slice(50, 80)) {
      expect(state.fighters.map((f) => [f.x, f.vx])).toEqual([
        [12_000, 0],
        [72_000, 0],
      ]);
    }
  });

  it('a back jump at the limit loses its horizontal velocity and lands in place', () => {
    const ticks = runScenario('max-separation');
    expect(ticks[80]?.state.fighters[0]).toMatchObject({ x: 12_000, vx: 0, y: 1950 });
    expect(ticks[80]?.events).toEqual([{ type: 'jump', frame: 80, player: 0 }]);
    for (const { state } of ticks.slice(80, 120)) expect(state.fighters[0].x).toBe(12_000);
    expect(ticks[119]?.events).toEqual([{ type: 'land', frame: 119, player: 0 }]);
    expect(ticks[119]?.state.fighters[0]).toMatchObject({ x: 12_000, y: 0, grounded: true });
  });
});

describe('movement events', () => {
  it('pins jump and land for both players on the same ticks, in player order', () => {
    const ticks = trace(createInitialState(), (f) => (f === 0 ? [UP, UP] : [0, 0]), 45);
    expect(ticks.flatMap((t) => t.events)).toEqual([
      { type: 'jump', frame: 0, player: 0 },
      { type: 'jump', frame: 0, player: 1 },
      { type: 'land', frame: 39, player: 0 },
      { type: 'land', frame: 39, player: 1 },
    ]);
  });

  it('orders land before wall-contact within a player, player 0 first, once per contact', () => {
    // Both walk back 3 ticks (x 22800 / 73200) and back-jump on frame 3 at 500 per tick:
    // airborne tick 40 (frame 42) lands at x 2800 / 93200, clamped by the standing box to the
    // walls, while the airborne box was 1300 from them on the tick before.
    const back = (f: number): FrameInputs =>
      f < 3 ? [LEFT, RIGHT] : f === 3 ? [UP | LEFT, UP | RIGHT] : [0, 0];
    const ticks = trace(createInitialState(), back, 100);
    expect(ticks.flatMap((t) => t.events)).toEqual([
      { type: 'jump', frame: 3, player: 0 },
      { type: 'jump', frame: 3, player: 1 },
      { type: 'land', frame: 42, player: 0 },
      { type: 'wall-contact', frame: 42, player: 0, side: 'left' },
      { type: 'land', frame: 42, player: 1 },
      { type: 'wall-contact', frame: 42, player: 1, side: 'right' },
    ]);
    expect(ticks[41]?.state.fighters.map((f) => f.x)).toEqual([3300, 92_700]);
    expect(ticks[42]?.state.fighters.map((f) => [f.x, f.vx])).toEqual([
      [3000, 0],
      [93_000, 0],
    ]);
  });

  it('fires wall-contact again only after leaving the wall', () => {
    const script = (f: number): FrameInputs => [f % 200 < 120 ? LEFT : RIGHT, 0];
    const events = trace(createInitialState(), script, 600).flatMap((t) => t.events);
    // Reaches x 3000 on frame 52 and stays (no event while held there); walks right 80 ticks
    // from frame 120 to x 35000; frame 200 reverses (vx 400 → 0), then 80 ticks back reach the
    // wall again on frame 280; the same from frame 320 gives frame 480.
    expect(events).toEqual([
      { type: 'wall-contact', frame: 52, player: 0, side: 'left' },
      { type: 'wall-contact', frame: 280, player: 0, side: 'left' },
      { type: 'wall-contact', frame: 480, player: 0, side: 'left' },
    ]);
  });
});

describe('symmetry', () => {
  it('mirrored scripts give mirrored state and events on every frame, for both sets', () => {
    const ids = [
      'walk-forward',
      'walk-back',
      'crouch',
      'neutral-jump',
      'forward-jump',
      'back-jump',
      'corner-push',
      'cross-up',
      'max-separation',
    ];
    for (const [, params] of SETS) {
      for (const id of ids) {
        const s = scenario(id);
        const initial = createInitialState(scenarioOptions(s, params));
        const width = initial.arena.width;
        const mirroredStart = { ...initial, fighters: mirrorSlice(initial.fighters, width) };
        const ticks = trace(initial, s.inputs, s.frames);
        const mirrored = trace(mirroredStart, (f) => mirrorInputs(s.inputs(f)), s.frames);
        ticks.forEach((tick, i) => {
          const other = mirrored[i];
          expect(other?.state.fighters, `${id} frame ${i}`).toEqual(
            mirrorSlice(tick.state.fighters, width),
          );
          expect(other?.events).toEqual(tick.events.map(mirrorEvent));
        });
      }
    }
  });
});

describe('movement determinism', () => {
  const OPTIONS: InitialStateOptions = { seed: 3, historyCapacity: 16 };

  it('the mixed script exercises walking, crouching, jumps, collisions and walls', () => {
    const ticks = trace(createInitialState(OPTIONS), MIXED_SCRIPT, 3600);
    const types = new Set(ticks.flatMap((t) => t.events.map((e) => e.type)));
    expect([...types].sort()).toEqual(['jump', 'land', 'wall-contact']);
    expect(ticks.some((t) => t.state.fighters.some((f) => f.crouching))).toBe(true);
    const gaps = ticks.map(
      ({
        state: {
          fighters: [a, b],
        },
      }) => Math.abs(a.x - b.x),
    );
    expect(Math.min(...gaps)).toBeLessThanOrEqual(6000);
  });

  it('is byte-identical over 3,600 frames and restores mid-air to the same run', () => {
    const a = trace(createInitialState(OPTIONS), MIXED_SCRIPT, 3600);
    const b = trace(createInitialState(OPTIONS), MIXED_SCRIPT, 3600);
    expect(a.map((t) => serializeState(t.state))).toEqual(b.map((t) => serializeState(t.state)));
    expect(JSON.stringify(a.flatMap((t) => t.events))).toBe(
      JSON.stringify(b.flatMap((t) => t.events)),
    );

    const split = a.findIndex((t, i) => i > 1000 && t.state.fighters.some((f) => !f.grounded));
    expect(split).toBeGreaterThan(1000);
    const midAir = a[split]?.state;
    if (!midAir) throw new Error('no mid-air frame');
    const restored = deserializeState(serializeState(midAir));
    expect(restored).toEqual(midAir);
    const rest = trace(restored, MIXED_SCRIPT, 3600 - split - 1);
    expect(serializeState(rest.at(-1)?.state ?? restored)).toBe(
      serializeState(a.at(-1)?.state ?? midAir),
    );
    expect(rest.flatMap((t) => t.events)).toEqual(a.slice(split + 1).flatMap((t) => t.events));
  });

  it('does not mutate its input and stores only int32 numbers', () => {
    const ticks = trace(createInitialState(OPTIONS), MIXED_SCRIPT, 3600);
    for (const { state } of ticks.filter((_, i) => i % 50 === 0)) {
      const frozen = deepFreeze(deserializeState(serializeState(state)));
      const snapshot = serializeState(frozen);
      step(frozen, MIXED_SCRIPT(frozen.frame));
      expect(serializeState(frozen)).toBe(snapshot);
      for (const n of numbersIn(state)) {
        expect(Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647).toBe(true);
      }
    }
  });
});

describe('movement validation', () => {
  const withParam = (player: 0 | 1, path: string[], value: unknown) => {
    // The copy is deliberately invalid at `path`; the type only lets it into the options.
    const params = JSON.parse(JSON.stringify(DEFAULT_MOVEMENT_PARAMETERS)) as MovementParameters;
    let node: Record<string, unknown> = params;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[path.at(-1) ?? ''] = value;
    const pair: [MovementParameters, MovementParameters] = [
      DEFAULT_MOVEMENT_PARAMETERS,
      DEFAULT_MOVEMENT_PARAMETERS,
    ];
    pair[player] = params;
    return pair;
  };
  const paramCases: [string, 0 | 1, string[], unknown][] = [
    ['a non-integer speed', 0, ['walkForwardSpeed'], 1.5],
    ['a non-positive size', 1, ['pushboxes', 'standing', 'height'], 0],
    ['a non-positive speed', 0, ['jumpBackSpeed'], 0],
    ['a negative acceleration', 1, ['walkAcceleration'], -1],
    ['a zero friction', 0, ['groundFriction'], 0],
    ['an odd pushbox width', 1, ['pushboxes', 'crouching', 'width'], 6001],
  ];

  it.each(paramCases)('rejects %s, naming the path', (_, player, path, value) => {
    const failing = ['state', 'fighters', player, 'params', ...path].join('.');
    expect(() => createInitialState({ movement: withParam(player, path, value) })).toThrow(failing);
    const good = JSON.parse(serializeState(createInitialState())) as {
      state: { fighters: { params: unknown }[] };
    };
    const fighter = good.state.fighters[player];
    if (fighter) fighter.params = withParam(player, path, value)[player];
    expect(() => deserializeState(JSON.stringify(good))).toThrow(failing);
  });

  const arenaCases: [string, object, string][] = [
    [
      'an arena narrower than both pushboxes',
      { width: 11_999 },
      'arena.width: must be at least 12000',
    ],
    [
      'a maxSeparation not above both half-widths',
      { width: 96_000, maxSeparation: 6000 },
      'arena.maxSeparation: must be greater than 6000',
    ],
    [
      'a maxSeparation above the width',
      { width: 96_000, maxSeparation: 96_001 },
      'arena.maxSeparation: must be at most',
    ],
    ['a non-integer width', { width: 96_000.5 }, 'arena.width'],
  ];

  it.each(arenaCases)('rejects %s, naming the path', (_, arena, message) => {
    expect(() => createInitialState({ arena: arena as { width: number } })).toThrow(message);
    const good = JSON.parse(serializeState(createInitialState())) as { state: { arena: object } };
    good.state.arena = arena;
    expect(() => deserializeState(JSON.stringify(good))).toThrow(`state.${message}`);
  });

  it('accepts the boundary values and different parameters per player', () => {
    const tight = createInitialState({ arena: { width: 12_000, maxSeparation: 6001 } });
    expect(tight.fighters.map((f) => f.x)).toEqual([3000, 9000]);
    const mixed = createInitialState({
      movement: [DEFAULT_MOVEMENT_PARAMETERS, RAMPED_MOVEMENT_PARAMETERS],
      arena: { width: 14_000 }, // 6000 + the ramped crouching width 8000
    });
    expect(mixed.fighters[1].params).toEqual(RAMPED_MOVEMENT_PARAMETERS);
    expect(deserializeState(serializeState(mixed))).toEqual(mixed);
  });
});

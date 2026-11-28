import type { Container } from 'pixi.js';
import { worldToScreen, type RenderFrame } from '@mortal-doctrine/renderer';
import {
  createInitialState,
  type SimulationEvent,
  type SimulationState,
} from '@mortal-doctrine/simulation';
import { describe, expect, it } from 'vitest';
import {
  createEffectsRenderable,
  KEY_WINDOW_FRAMES,
  parseEffectDefinitions,
  parseEffectMapping,
  type EffectsRenderable,
} from '../src/index';
import { CORE_EFFECTS, CORE_MAPPING, FIXTURE_EVENTS, TWIN_LAND_EVENTS } from '../src/testing';

// 2 px per world unit, world origin at screen (100, 500).
const VIEW = { scale: 2, originX: 100, originY: 500 };
const INITIAL = createInitialState();

/** The initial snapshot at `frame`, player one moved to (30000, 2500). */
function snapshot(frame: number): SimulationState {
  const [p0, p1] = INITIAL.fighters;
  return { ...INITIAL, frame, fighters: [{ ...p0, x: 30_000, y: 2500 }, p1] };
}

function feed(effects: EffectsRenderable, frame: number, events: readonly SimulationEvent[]) {
  const renderFrame: RenderFrame = {
    state: snapshot(frame),
    previous: undefined,
    alpha: 0,
    events,
    view: VIEW,
  };
  effects.update(renderFrame);
}

const create = () => createEffectsRenderable({ definitions: CORE_EFFECTS, mapping: CORE_MAPPING });
const ids = (effects: EffectsRenderable) => effects.active.map(({ id }) => id);
/** Every display object below `root`, root included. */
const tree = (root: Container): Container[] => [
  root,
  ...root.children.flatMap((child) => tree(child)),
];

describe('spawning', () => {
  it('spawns one mapped effect at the fighter plus offset, through the view', () => {
    const effects = create();
    feed(effects, 11, [FIXTURE_EVENTS.land]);
    expect(ids(effects)).toEqual(['core/land-ring']);
    const [spawned] = effects.container.children;
    expect(spawned?.position).toMatchObject(worldToScreen(VIEW, 30_000, 2500));
    expect(spawned?.scale.x).toBe(VIEW.scale);

    // The command flash is offset 12000 sub-units up.
    feed(effects, 12, [FIXTURE_EVENTS.command]);
    expect(effects.container.children[1]?.position).toMatchObject(
      worldToScreen(VIEW, 30_000, 2500 + 12_000),
    );
    // Player two stands at the initial position.
    feed(effects, 13, [FIXTURE_EVENTS.jump]);
    const { x, y } = INITIAL.fighters[1];
    expect(effects.container.children[2]?.position).toMatchObject(worldToScreen(VIEW, x, y));
    expect(ids(effects)).toEqual(['core/land-ring', 'core/command-flash', 'core/dust-burst']);
  });

  it('spawns nothing for an unmapped event type', () => {
    const effects = createEffectsRenderable({
      definitions: CORE_EFFECTS,
      mapping: { land: { effect: 'core/land-ring' } },
    });
    feed(effects, 11, [FIXTURE_EVENTS.command, FIXTURE_EVENTS.jump, FIXTURE_EVENTS.wallContact]);
    expect(effects.active).toEqual([]);
    expect(effects.container.children).toHaveLength(0);
  });

  it('creates the configured particle count, spread by the event identity', () => {
    const effects = create();
    feed(effects, 11, [FIXTURE_EVENTS.jump]);
    effects.advance(450);
    const particles = effects.container.children[0]!.children.map(({ x, y }) => ({ x, y }));
    expect(particles).toHaveLength(8);
    // Halfway through its life every particle is 35 world units out, not all in one place.
    for (const { x, y } of particles) expect(Math.hypot(x, y)).toBeCloseTo(35, 9);
    expect(new Set(particles.map(({ x }) => x.toFixed(6))).size).toBeGreaterThan(1);

    // The same event elsewhere gives the same spread.
    const again = create();
    feed(again, 11, [FIXTURE_EVENTS.jump]);
    again.advance(450);
    expect(again.container.children[0]!.children.map(({ x, y }) => ({ x, y }))).toEqual(particles);
  });
});

describe('idempotence', () => {
  it('spawns each event identity once, clears on a backwards frame or clear(), then respawns once', () => {
    const effects = create();
    const log = (step: string) => console.log(`${step}: active ${effects.active.length}`);

    feed(effects, 11, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump]);
    log('frame 11, land + jump');
    expect(effects.active).toHaveLength(2);

    feed(effects, 11, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump]);
    log('frame 11 again, same batch');
    feed(effects, 14, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump]);
    log('frame 14, same batch re-fed');
    expect(effects.active).toHaveLength(2);

    feed(effects, 15, TWIN_LAND_EVENTS);
    log('frame 15, two identical land events');
    // The first land is the identity already spawned; the second is a new occurrence.
    expect(effects.active).toHaveLength(3);
    const keys = effects.active.map(({ key }) => key);
    expect(new Set(keys).size).toBe(3);

    // Restore / seek backwards.
    feed(effects, 10, []);
    log('frame 10 (restore)');
    expect(effects.active).toEqual([]);
    expect(effects.container.children).toHaveLength(0);

    // Re-simulating the same frames shows each effect once.
    feed(effects, 11, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump]);
    feed(effects, 11, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump]);
    log('frame 11 re-simulated twice');
    expect(ids(effects)).toEqual(['core/land-ring', 'core/dust-burst']);

    effects.clear();
    log('clear()');
    expect(effects.active).toEqual([]);
    feed(effects, 11, TWIN_LAND_EVENTS);
    feed(effects, 12, TWIN_LAND_EVENTS);
    log('frame 11 and 12, twin land events after clear()');
    expect(ids(effects)).toEqual(['core/land-ring', 'core/land-ring']);
  });

  it('forgets spawned events older than the key window', () => {
    const effects = create();
    feed(effects, 11, [FIXTURE_EVENTS.land]);
    effects.advance(1000);
    feed(effects, 10 + KEY_WINDOW_FRAMES, [FIXTURE_EVENTS.land]);
    expect(effects.active).toEqual([]);
    feed(effects, 11 + KEY_WINDOW_FRAMES, [FIXTURE_EVENTS.land]);
    expect(ids(effects)).toEqual(['core/land-ring']);
  });
});

describe('lifetime and cleanup', () => {
  it('ages only by supplied display time and destroys an expired effect', () => {
    const effects = create();
    feed(effects, 11, [FIXTURE_EVENTS.land]);
    const objects = tree(effects.container.children[0]!);
    expect(objects.length).toBeGreaterThan(1);

    // Drawn frames without display time do not age it.
    for (let frame = 12; frame < 40; frame++) feed(effects, frame, []);
    expect(effects.active[0]?.ageMs).toBe(0);
    effects.advance(0);
    expect(effects.active[0]?.ageMs).toBe(0);

    effects.advance(250);
    expect(effects.active).toEqual([
      {
        id: 'core/land-ring',
        key: '[["frame",10],["player",0],["type","land"]]#0',
        ageMs: 250,
        lifetimeMs: 600,
      },
    ]);
    expect(objects.some(({ destroyed }) => destroyed)).toBe(false);

    effects.advance(350);
    expect(effects.active).toEqual([]);
    expect(effects.container.children).toHaveLength(0);
    expect(objects.every(({ destroyed }) => destroyed)).toBe(true);
  });

  it('destroy() destroys every live effect and its container; later calls are no-ops', () => {
    const effects = create();
    feed(effects, 11, [FIXTURE_EVENTS.land, FIXTURE_EVENTS.jump, FIXTURE_EVENTS.command]);
    const objects = tree(effects.container);
    expect(objects.length).toBeGreaterThan(10);
    effects.destroy();
    expect(objects.every(({ destroyed }) => destroyed)).toBe(true);
    expect(effects.active).toEqual([]);
    effects.destroy();
    feed(effects, 12, [FIXTURE_EVENTS.jump]);
    effects.advance(100);
    expect(effects.active).toEqual([]);
  });
});

describe('validation', () => {
  const sprite = CORE_EFFECTS[0]!;
  const particles = CORE_EFFECTS[2]!;

  it.each(['Hit-Spark', 'core/', 'a/b/c', 'core/Hit', 'core/hit_spark', '/hit'])(
    'rejects the effect id %j',
    (id) => {
      expect(() => parseEffectDefinitions([{ ...sprite, id }])).toThrow(
        /^Invalid effect definitions: 0\.id: must be "core\/<name>" or "<character>\/<name>"/,
      );
    },
  );

  it('accepts core and character ids', () => {
    expect(
      parseEffectDefinitions([
        { ...sprite, id: 'core/hit-spark' },
        { ...sprite, id: 'monk/chi-burst' },
      ]).map(({ id }) => id),
    ).toEqual(['core/hit-spark', 'monk/chi-burst']);
  });

  it('rejects a duplicate id', () => {
    expect(() => parseEffectDefinitions([sprite, particles, sprite])).toThrow(
      'Invalid effect definitions: 2.id: duplicate effect id "core/land-ring"',
    );
  });

  it.each([
    ['lifetimeMs', { ...sprite, lifetimeMs: 0 }],
    ['lifetimeMs', { ...particles, lifetimeMs: -5 }],
    ['count', { ...particles, count: 0 }],
    ['count', { ...particles, count: 1.5 }],
    ['size', { ...sprite, size: 0 }],
    ['colour', { ...sprite, colour: 0x1000000 }],
  ])('names the field %s', (field, definition) => {
    expect(() => parseEffectDefinitions([definition])).toThrow(
      `Invalid effect definitions: 0.${field}:`,
    );
  });

  it('rejects a mapping to an effect missing from the registry, naming the entry', () => {
    expect(() =>
      parseEffectMapping({ ...CORE_MAPPING, jump: { effect: 'core/missing' } }, CORE_EFFECTS),
    ).toThrow('Invalid effect mapping: jump.effect: unknown effect "core/missing"');
    expect(() =>
      createEffectsRenderable({
        definitions: CORE_EFFECTS,
        mapping: { land: { effect: 'Core/land-ring' } },
      }),
    ).toThrow(/^Invalid effect mapping: land\.effect: must be/);
    expect(() =>
      parseEffectMapping({ land: { effect: 'core/land-ring', offset: { x: 1.5, y: 0 } } }, []),
    ).toThrow(/land\.offset\.x/);
  });

  it('accepts the fixtures', () => {
    expect(parseEffectMapping(CORE_MAPPING, parseEffectDefinitions(CORE_EFFECTS))).toEqual(
      CORE_MAPPING,
    );
  });
});

import { pushboxOf } from '@mortal-doctrine/movement';
import { MOVEMENT_SCENARIOS } from '@mortal-doctrine/movement/testing';
import { worldToScreen, type View } from '@mortal-doctrine/renderer';
import {
  createInitialState,
  step,
  type InputProvider,
  type SimulationEvent,
  type SimulationState,
} from '@mortal-doctrine/simulation';
import { walkCycleScript } from '@mortal-doctrine/simulation/testing';
import { describe, expect, it } from 'vitest';
import { createCamera, visibleSpan, type CameraConfig, type CameraOutput } from '../src/index';
import { FIXTURE_CAMERA_CONFIG } from '../src/testing';

const CONFIG = FIXTURE_CAMERA_CONFIG;
const { width: VIEWPORT_WIDTH } = CONFIG.viewport;
const INITIAL = createInitialState();
// Floating-point slack, in sub-units and in pixels.
const SLACK = 1e-6;

/** The initial state with the fighters moved to `x0` and `x1`, at `frame`. */
function place(x0: number, x1: number, frame = 0): SimulationState {
  const [p0, p1] = INITIAL.fighters;
  return {
    ...INITIAL,
    frame,
    fighters: [
      { ...p0, x: x0 },
      { ...p1, x: x1 },
    ],
  };
}

const land = (frame: number): SimulationEvent => ({ type: 'land', frame, player: 0 });
const span = (view: View) => visibleSpan(view, VIEWPORT_WIDTH);
const magnitude = ({ shake }: CameraOutput) => Math.hypot(shake.x, shake.y);

function expectWithinBounds(view: View, config: CameraConfig = CONFIG) {
  const visible = visibleSpan(view, config.viewport.width);
  expect(visible.left).toBeGreaterThanOrEqual(config.bounds.left - SLACK);
  expect(visible.right).toBeLessThanOrEqual(config.bounds.right + SLACK);
}

/** Both fighters' current pushboxes map inside the viewport horizontally. */
function expectFramed(view: View, state: SimulationState) {
  for (const fighter of state.fighters) {
    const half = pushboxOf(fighter).width / 2;
    expect(worldToScreen(view, fighter.x - half, 0).x).toBeGreaterThanOrEqual(-SLACK);
    expect(worldToScreen(view, fighter.x + half, 0).x).toBeLessThanOrEqual(VIEWPORT_WIDTH + SLACK);
  }
}

/** Runs `script` through `step`, feeding the camera every snapshot. */
function film(script: InputProvider, frames: number, state = INITIAL, config = CONFIG) {
  const camera = createCamera(config);
  const shots = [{ state, output: camera.update(state) }];
  for (let i = 0; i < frames; i++) {
    const result = step(state, script(state.frame));
    state = result.state;
    shots.push({ state, output: camera.update(state, result.events) });
  }
  return shots;
}

describe('framing', () => {
  // Standing pushbox 6000 wide, margin 8000 a side: visible width = separation + 22000,
  // limited to [48000, 104000].
  it.each([
    { name: 'same x', x0: 48_000, x1: 48_000, width: 48_000 },
    { name: 'both at the left wall', x0: 3000, x1: 9000, width: 48_000 },
    { name: 'both at the right wall', x0: 87_000, x1: 93_000, width: 48_000 },
    { name: 'separation 26000 (exactly the minimum)', x0: 30_000, x1: 56_000, width: 48_000 },
    { name: 'start positions', x0: 24_000, x1: 72_000, width: 70_000 },
    { name: 'separation 80000', x0: 10_000, x1: 90_000, width: 102_000 },
    { name: 'opposite walls', x0: 3000, x1: 93_000, width: 104_000 },
    { name: 'opposite walls, sides swapped', x0: 93_000, x1: 3000, width: 104_000 },
  ])('$name: both fighters in frame at visible width $width', ({ x0, x1, width }) => {
    const camera = createCamera(CONFIG);
    camera.update(INITIAL);
    let output = camera.update(place(x0, x1, 1));
    for (let frame = 2; frame <= 120; frame++) output = camera.update(place(x0, x1, frame));
    const state = place(x0, x1);
    const visible = span(output.view);

    expectFramed(output.view, state);
    expectWithinBounds(output.view);
    expect(visible.right - visible.left).toBeCloseTo(width, 6);
    expect(output.target.right - output.target.left).toBe(width);
    // Converged is where a camera that starts on this snapshot stands at once.
    expect(output.view).toEqual(createCamera(CONFIG).update(state).view);
  });

  it('keeps the ground line at the configured margin at every zoom', () => {
    const near = createCamera(CONFIG).update(place(40_000, 46_000)).view;
    const far = createCamera(CONFIG).update(place(3000, 93_000)).view;
    expect(near.scale).toBe(2);
    expect(far.scale).toBeLessThan(1);
    expect(near.originY).toBe(460);
    expect(far.originY).toBe(460);
  });

  it.each(['corner-push', 'cross-up', 'max-separation'])(
    'keeps both pushboxes in the pre-shake view on every frame of %s',
    (id) => {
      const scenario = MOVEMENT_SCENARIOS.find((s) => s.id === id);
      if (!scenario) throw new Error(`No movement scenario ${id}`);
      const start = createInitialState(scenario.arena ? { arena: scenario.arena } : {});
      const shots = film(scenario.inputs, scenario.frames, start);
      expect(shots).toHaveLength(scenario.frames + 1);
      for (const { state, output } of shots) {
        expectFramed(output.steady, state);
        expectWithinBounds(output.view);
      }
    },
  );

  it('keeps both pushboxes in the pre-shake view through 180 frames of the walk cycle', () => {
    const shots = film(walkCycleScript, 180);
    // The cycle reaches the right wall, so shake is exercised against the bound as well.
    expect(shots.some(({ output }) => magnitude(output) > 0)).toBe(true);
    for (const { state, output } of shots) {
      expectFramed(output.steady, state);
      expectWithinBounds(output.view);
    }
  });
});

describe('headroom', () => {
  const scenario = (id: string) => {
    const found = MOVEMENT_SCENARIOS.find((s) => s.id === id);
    if (!found) throw new Error(`No movement scenario ${id}`);
    return found;
  };
  const widthOf = (view: View) => span(view).right - span(view).left;
  /** The point `headroom` above every fighter is not above the viewport top. */
  function expectHeadroom(view: View, state: SimulationState, config: CameraConfig = CONFIG) {
    for (const fighter of state.fighters) {
      expect(worldToScreen(view, fighter.x, fighter.y + config.headroom).y).toBeGreaterThanOrEqual(
        -SLACK,
      );
    }
  }
  /** Player 1 jumps on the first frame; both fighters start at `x0` and `x1`. */
  const jump = (x0: number, x1: number, config = CONFIG) =>
    film(scenario('neutral-jump').inputs, 60, place(x0, x1), config);

  it.each(['neutral-jump', 'forward-jump'])(
    'keeps the headroom above both fighters in the pre-shake view on every frame of %s',
    (id) => {
      const { inputs, frames } = scenario(id);
      const shots = film(inputs, frames);
      // 200 world units up at the apex, and 230 are visible above the ground at the closest zoom.
      expect(Math.max(...shots.map(({ state }) => state.fighters[0].y))).toBeGreaterThan(15_000);
      for (const { state, output } of shots) {
        expectHeadroom(output.steady, state);
        expectFramed(output.steady, state);
        expectWithinBounds(output.view);
        // The ground line does not move.
        expect(output.steady.originY).toBe(CONFIG.viewport.height - CONFIG.groundMargin);
      }
    },
  );

  it('zooms out past the closest zoom during a jump and rests on the grounded target again', () => {
    const shots = jump(40_000, 46_000);
    const widths = shots.map(({ output }) => widthOf(output.steady));
    expect(widths[0]).toBe(CONFIG.minVisibleWidth);
    // Apex 20000 + headroom 20000 at the top of the 460 px above the ground line.
    expect(Math.max(...widths)).toBeCloseTo((40_000 * 960) / 460, 6);
    // 23000 sub-units are visible above the ground at the closest zoom: higher than 3000, the
    // headroom no longer fits in it.
    const high = shots.filter(({ state }) => state.fighters[0].y > 3000);
    expect(high.length).toBeGreaterThan(30);
    for (const { output } of high) {
      expect(widthOf(output.steady)).toBeGreaterThan(CONFIG.minVisibleWidth);
    }

    // Landed: the target is the grounded one at once, and the view comes to rest exactly on it.
    const camera = createCamera(CONFIG);
    let output = camera.update(shots[0]!.state);
    for (const { state } of shots) output = camera.update(state);
    const landed = shots.at(-1)!.state;
    expect(landed.fighters[0].grounded).toBe(true);
    expect(output).toEqual(shots.at(-1)!.output);
    expect(output.target.right - output.target.left).toBe(CONFIG.minVisibleWidth);
    for (let frame = landed.frame + 1; frame <= landed.frame + 120; frame++) {
      output = camera.update({ ...landed, frame });
    }
    expect(output.steady).toEqual(createCamera(CONFIG).update(landed).steady);
    expect(output.steady.scale).toBe(2);
  });

  it.each<{ name: string; config: CameraConfig; limit: number }>([
    { name: 'maxVisibleWidth', config: { ...CONFIG, maxVisibleWidth: 60_000 }, limit: 60_000 },
    {
      name: 'the bounds',
      config: { ...CONFIG, bounds: { left: 10_000, right: 70_000 } },
      limit: 60_000,
    },
  ])('never shows more than $name for a jump that needs more', ({ config, limit }) => {
    const shots = jump(40_000, 46_000, config);
    for (const { output } of shots) {
      expectWithinBounds(output.view, config);
      expectWithinBounds(output.steady, config);
      expect(widthOf(output.steady)).toBeLessThanOrEqual(limit + SLACK);
    }
    // The limit was reached: the fit asked for more.
    expect(Math.max(...shots.map(({ output }) => widthOf(output.steady)))).toBeCloseTo(limit, 6);
  });

  it('films a jump twice with deeply equal outputs', () => {
    const outputs = () => jump(40_000, 46_000).map(({ output }) => output);
    expect(outputs()).toEqual(outputs());
  });

  it('snaps to a view with the headroom on a seek into the middle of a jump', () => {
    const shots = jump(40_000, 46_000);
    const apex = shots.reduce((a, b) => (b.state.fighters[0].y > a.state.fighters[0].y ? b : a));
    expect(apex.state.frame).toBeGreaterThan(15);
    const camera = createCamera(CONFIG);
    camera.update(shots[0]!.state);
    const output = camera.update(apex.state);
    expect(output).toEqual(createCamera(CONFIG).update(apex.state));
    expectHeadroom(output.steady, apex.state);
    expectFramed(output.steady, apex.state);
    expect(widthOf(output.steady)).toBeGreaterThan(CONFIG.minVisibleWidth);
  });
});

describe('visual bounds', () => {
  const narrow: CameraConfig = { ...CONFIG, bounds: { left: 20_000, right: 50_000 } };
  const tight: CameraConfig = { ...CONFIG, bounds: { left: 0, right: 96_000 } };

  it.each([
    { name: 'fighters at the left wall', config: CONFIG, x0: 3000, x1: 9000, left: -4000 },
    { name: 'fighters at the right wall', config: CONFIG, x0: 87_000, x1: 93_000, left: 52_000 },
    { name: 'maximum zoom-out', config: CONFIG, x0: 3000, x1: 93_000, left: -4000 },
    { name: 'bounds narrower than maximum zoom-out', config: tight, x0: 3000, x1: 93_000, left: 0 },
    { name: 'bounds narrower than minimum zoom', config: narrow, x0: 3000, x1: 9000, left: 20_000 },
    { name: 'narrow bounds, far apart', config: narrow, x0: 3000, x1: 93_000, left: 20_000 },
  ])('$name: the visible span starts at $left and stays inside', ({ config, x0, x1, left }) => {
    const { view, steady } = createCamera(config).update(place(x0, x1));
    expectWithinBounds(view, config);
    expectWithinBounds(steady, config);
    expect(visibleSpan(view, config.viewport.width).left).toBeCloseTo(left, 6);
  });

  it.each([
    { name: 'left', x: 3000 },
    { name: 'right', x: 87_000 },
  ])('holds on every frame of a shake against the $name bound', ({ x }) => {
    const camera = createCamera(CONFIG);
    camera.update(place(x, x + 6000, 0));
    const frames = CONFIG.shake.land?.frames ?? 0;
    let shaken = 0;
    let clamped = 0;
    for (let frame = 1; frame <= frames + 2; frame++) {
      const output = camera.update(place(x, x + 6000, frame), frame === 1 ? [land(0)] : []);
      expectWithinBounds(output.view);
      if (output.shake.x !== 0) shaken++;
      if (Math.abs(output.view.originX - output.steady.originX) < Math.abs(output.shake.x)) {
        clamped++;
      }
      // Vertical shake is not limited by the horizontal bounds.
      expect(output.view.originY - output.steady.originY).toBeCloseTo(output.shake.y, 9);
    }
    expect(shaken).toBe(frames);
    // Some of the offsets pointed out of bounds and were cut.
    expect(clamped).toBeGreaterThan(0);
    expect(clamped).toBeLessThan(frames);
  });
});

describe('smoothing', () => {
  it('moves toward a new target over several frames, monotonically, and reaches it', () => {
    const camera = createCamera(CONFIG);
    // Player 1 appears 6000 to the right and player 2 13000: a pan and a zoom-out.
    const centres: number[] = [];
    const widths: number[] = [];
    let output = camera.update(place(24_000, 72_000, 0));
    for (let frame = 1; frame <= 200; frame++) {
      const visible = span(output.steady);
      centres.push((visible.left + visible.right) / 2);
      widths.push(visible.right - visible.left);
      output = camera.update(place(30_000, 85_000, frame));
    }
    expect(output.target).toEqual({ left: 19_000, right: 96_000 });
    expect([centres[0], widths[0]]).toEqual([48_000, 70_000]);

    // Not in one frame, and never past or away from the target (centre 57500, width 77000).
    expect(centres[1]).toBeLessThan(56_500);
    expect(widths[1]).toBeLessThan(76_000);
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i]).toBeGreaterThanOrEqual((centres[i - 1] ?? NaN) - SLACK);
      expect(centres[i]).toBeLessThanOrEqual(57_500 + SLACK);
      expect(widths[i]).toBeGreaterThanOrEqual((widths[i - 1] ?? NaN) - SLACK);
      expect(widths[i]).toBeLessThanOrEqual(77_000 + SLACK);
    }
    expect(centres[1]).toBeGreaterThan(48_000);
    expect(widths[1]).toBeGreaterThan(70_000);
    // It comes to rest exactly on the target.
    expect(output.steady).toEqual(createCamera(CONFIG).update(place(30_000, 85_000)).steady);
    expect(camera.update(place(30_000, 85_000, 201)).steady).toEqual(output.steady);
  });

  it.each([
    { name: 'a backwards frame', from: 40, to: 39 },
    { name: 'a restart at frame 0', from: 40, to: 0 },
    { name: 'a seek far ahead', from: 40, to: 56 },
  ])('snaps in one update on $name, and drops the shake', ({ from, to }) => {
    const camera = createCamera(CONFIG);
    camera.update(place(24_000, 72_000, from - 1));
    expect(magnitude(camera.update(place(24_000, 72_000, from), [land(from - 1)]))).toBeGreaterThan(
      0,
    );
    const output = camera.update(place(60_000, 90_000, to), [land(to - 1)]);
    expect(output).toEqual(createCamera(CONFIG).update(place(60_000, 90_000, to)));
    expect(output.shake).toEqual({ x: 0, y: 0 });
    expect(output.view).toEqual(output.steady);
  });

  it('catches up k frames in one update exactly as k single-frame updates of a still scene', () => {
    const every = createCamera(CONFIG);
    const skipping = createCamera(CONFIG);
    for (const camera of [every, skipping]) {
      camera.update(place(24_000, 72_000, 0));
      camera.update(place(40_000, 90_000, 1));
    }
    every.update(place(40_000, 90_000, 2));
    every.update(place(40_000, 90_000, 3), [land(2)]);
    expect(skipping.update(place(40_000, 90_000, 4), [land(2)])).toEqual(
      every.update(place(40_000, 90_000, 4)),
    );
    // 15 frames is still catch-up, not a seek: the view has not snapped.
    const late = skipping.update(place(10_000, 20_000, 19));
    expect(late.steady).not.toEqual(createCamera(CONFIG).update(place(10_000, 20_000)).steady);
  });
});

describe('determinism', () => {
  function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(deepFreeze);
    }
    return value;
  }

  it('gives deeply equal output for the same snapshot and event sequence', () => {
    const first = film(walkCycleScript, 180).map(({ output }) => output);
    const second = film(walkCycleScript, 180).map(({ output }) => output);
    expect(second).toEqual(first);
    // The run is not trivial: the view moved and shook.
    expect(new Set(first.map(({ view }) => view.originX)).size).toBeGreaterThan(50);
    expect(first.some((output) => magnitude(output) > 0)).toBe(true);
  });

  it('returns the same view for the same frame again, without restarting or extending a shake', () => {
    const once = createCamera(CONFIG);
    const twice = createCamera(CONFIG);
    once.update(place(24_000, 72_000, 0));
    twice.update(place(24_000, 72_000, 0));
    for (let frame = 1; frame <= 20; frame++) {
      const events = frame === 1 ? [land(0)] : [];
      const expected = once.update(place(24_000, 72_000, frame), events);
      expect(twice.update(place(24_000, 72_000, frame), events)).toEqual(expected);
      // Fed again, with the shake event repeated and the fighters moved: nothing changes.
      expect(twice.update(place(30_000, 80_000, frame), [land(0), land(frame - 1)])).toBe(
        twice.update(place(24_000, 72_000, frame)),
      );
    }
    expect(magnitude(twice.update(place(24_000, 72_000, 20)))).toBe(0);
  });

  it('does not mutate the snapshot or the events (frozen inputs pass)', () => {
    const camera = createCamera(CONFIG);
    let state = deepFreeze(createInitialState());
    const before = JSON.stringify(state);
    camera.update(state);
    expect(JSON.stringify(state)).toBe(before);
    for (let i = 0; i < 120; i++) {
      const result = step(state, walkCycleScript(state.frame));
      state = deepFreeze(result.state);
      const events = deepFreeze([...result.events, land(state.frame - 1)]);
      const snapshot = JSON.stringify([state, events]);
      camera.update(state, events);
      expect(JSON.stringify([state, events])).toBe(snapshot);
    }
  });
});

describe('shake', () => {
  const still = (frame: number) => place(24_000, 72_000, frame);

  it.each(['land', 'wall-contact'] as const)(
    '%s shakes from its frame, within its amplitude, and decays to rest',
    (type) => {
      const { amplitude, frames } = CONFIG.shake[type] ?? { amplitude: 0, frames: 0 };
      const event: SimulationEvent =
        type === 'land'
          ? { type, frame: 4, player: 1 }
          : { type, frame: 4, player: 1, side: 'right' };
      const camera = createCamera(CONFIG);
      const rest = camera.update(still(4));
      const strengths: number[] = [];
      for (let age = 0; age < frames + 5; age++) {
        const output = camera.update(still(5 + age), age === 0 ? [event] : []);
        strengths.push(magnitude(output));
        // Shake moves the view only: same zoom, same pre-shake view.
        expect(output.view.scale).toBe(rest.view.scale);
        expect(output.steady).toEqual(rest.steady);
        expect(output.view.originX - output.steady.originX).toBeCloseTo(output.shake.x, 9);
        expect(output.view.originY - output.steady.originY).toBeCloseTo(output.shake.y, 9);
      }
      expect(strengths[0]).toBeCloseTo(amplitude, 9);
      for (let age = 1; age < frames; age++) {
        expect(strengths[age]).toBeGreaterThan(0);
        expect(strengths[age]).toBeLessThan(strengths[age - 1] ?? NaN);
      }
      // Exactly zero from the configured duration on.
      expect(strengths.slice(frames)).toEqual([0, 0, 0, 0, 0]);
      expect(camera.update(still(5 + frames + 5)).view).toEqual(rest.view);
    },
  );

  it('ignores event types without a shake entry, and stale events', () => {
    const camera = createCamera(CONFIG);
    camera.update(still(9));
    const jump: SimulationEvent = { type: 'jump', frame: 9, player: 0 };
    expect(camera.update(still(10), [jump]).shake).toEqual({ x: 0, y: 0 });
    // An event older than the ticks just run was already seen (or belongs to another timeline).
    expect(camera.update(still(11), [land(9)]).shake).toEqual({ x: 0, y: 0 });
    expect(magnitude(camera.update(still(12), [land(11)]))).toBeGreaterThan(0);
  });

  it('never exceeds the strongest configured amplitude when shakes overlap', () => {
    const camera = createCamera(CONFIG);
    camera.update(still(0));
    for (let frame = 1; frame <= 40; frame++) {
      const events: SimulationEvent[] =
        frame <= 20
          ? [land(frame - 1), { type: 'wall-contact', frame: frame - 1, player: 1, side: 'left' }]
          : [];
      const strength = magnitude(camera.update(still(frame), events));
      expect(strength).toBeLessThanOrEqual(12 + SLACK);
      if (frame <= 20) expect(strength).toBeCloseTo(12, 9);
    }
    expect(magnitude(camera.update(still(41)))).toBe(0);
  });
});

describe('configuration', () => {
  it('rejects an invalid configuration naming the fields', () => {
    expect(() =>
      createCamera({
        ...CONFIG,
        minVisibleWidth: 200_000,
        headroom: -1,
        smoothing: 0,
        shake: { land: { amplitude: 4, frames: 0 } },
      }),
    ).toThrow(
      'Invalid camera config: minVisibleWidth: must be > 0 and at most maxVisibleWidth; ' +
        'headroom: must be >= 0; ' +
        'smoothing: must be in (0, 1]; ' +
        'shake.land: amplitude must be >= 0 and frames a positive integer',
    );
  });
});

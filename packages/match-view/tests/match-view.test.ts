import type { CameraOutput } from '@mortal-doctrine/camera';
import { InputBit, type FrameInputs } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  createSimulationRunner,
  step,
  type SimulationEvent,
} from '@mortal-doctrine/simulation';
import { describe, expect, it } from 'vitest';
import { createPresenter, createTickSource, type DrawFrame, type Tick } from '../src/index';
import { fighterActivity, PRESENTATION, SESSION_OPTIONS } from '../src/testing';

const { RIGHT, UP } = InputBit;
const TICK_MS = 1000 / 60;

/** Both fighters jump, land and walk right: jump and land events on several ticks. */
const script = (frame: number): FrameInputs =>
  frame % 60 < 2 ? [UP | RIGHT, UP | RIGHT] : [RIGHT, RIGHT];

/** `count` ticks of the script from the fixture, stepped directly. */
function scriptedTicks(count: number): Tick[] {
  const ticks: Tick[] = [];
  let state = createInitialState(SESSION_OPTIONS);
  for (let i = 0; i < count; i++) {
    const result = step(state, script(state.frame));
    state = result.state;
    ticks.push(result);
  }
  return ticks;
}

/** A presenter that logs what its camera output, audio and draw received, in call order. */
function createLogged() {
  const calls: (
    { to: 'audio'; events: readonly SimulationEvent[] } | { to: 'draw'; frame: DrawFrame }
  )[] = [];
  const presenter = createPresenter({
    ...PRESENTATION,
    audio: { play: (events) => calls.push({ to: 'audio', events }) },
    draw: (frame) => calls.push({ to: 'draw', frame }),
  });
  return { calls, presenter };
}

describe('createPresenter', () => {
  // Ends two ticks after the first landing, while the camera still shakes from it.
  const all = scriptedTicks(90);
  const ticks = all.slice(
    0,
    all.findIndex(({ events }) => events.some((e) => e.type === 'land')) + 3,
  );
  const last = ticks.at(-1)!.state;
  const events = ticks.flatMap((tick) => tick.events);

  it('gives audio every tick once, in order, before one draw with every event', () => {
    expect(ticks.length).toBeGreaterThan(10);
    expect(ticks.filter((tick) => tick.events.length > 0).length).toBeGreaterThan(1);
    const { calls, presenter } = createLogged();
    presenter.present(last, ticks);

    expect(calls).toHaveLength(ticks.length + 1);
    expect(calls.slice(0, -1)).toEqual(ticks.map((tick) => ({ to: 'audio', events: tick.events })));
    const drawn = calls.at(-1);
    if (drawn?.to !== 'draw') throw new Error('the last call was not the draw');
    expect(drawn.frame.state).toBe(last);
    expect(drawn.frame.events).toEqual(events);
  });

  it('feeds the camera every tick: one batch and one tick per draw end on the same output', () => {
    const batch = createLogged();
    const batched = batch.presenter.present(last, ticks);

    const single = createLogged();
    const outputs: CameraOutput[] = ticks.map((tick) =>
      single.presenter.present(tick.state, [tick]),
    );
    expect(batched).toEqual(outputs.at(-1));
    // The camera moved on the way and still shakes from the landing: a camera fed only the last
    // snapshot never saw that event.
    expect(batched.shake).not.toEqual({ x: 0, y: 0 });
    expect(new Set(outputs.map(({ view }) => JSON.stringify(view))).size).toBeGreaterThan(10);
    expect(createLogged().presenter.present(last, [])).not.toEqual(batched);

    const drawn = batch.calls.at(-1);
    if (drawn?.to !== 'draw') throw new Error('the last call was not the draw');
    expect(drawn.frame.view).toEqual(batched.view);
  });

  it('draws both fighters with the given pose function of the drawn snapshot', () => {
    const { calls, presenter } = createLogged();
    const walking = ticks.find((tick) => fighterActivity(tick.state.fighters[0]) === 'walk')!.state;
    presenter.present(walking, []);
    const drawn = calls.at(-1);
    if (drawn?.to !== 'draw') throw new Error('the last call was not the draw');
    expect(drawn.frame.poses).toEqual(
      walking.fighters.map((fighter) => PRESENTATION.pose(fighter, walking.frame)),
    );
    expect(drawn.frame.poses[0]).not.toEqual({});
  });
});

describe('createTickSource', () => {
  it('returns one tick per tick run, each event under the tick it started from', () => {
    const runner = createSimulationRunner(SESSION_OPTIONS);
    const source = createTickSource(() => runner.state, script);
    const expected = scriptedTicks(90);

    // Display frames of 0, 1 and 3 ticks, then the rest in single steps.
    expect(source.run(() => runner.advance(TICK_MS / 2, source.inputs).events)).toEqual([]);
    const one = source.run(() => runner.advance(TICK_MS / 2, source.inputs).events);
    const three = source.run(() => runner.advance(3 * TICK_MS, source.inputs).events);
    expect(one).toHaveLength(1);
    expect(three).toHaveLength(3);
    const ticks = [...one, ...three];
    while (ticks.length < expected.length) {
      ticks.push(...source.run(() => runner.stepOnce(source.inputs)));
    }

    expect(ticks).toEqual(expected);
    expect(ticks.at(-1)?.state).toBe(runner.state);
    ticks.forEach((tick, index) => {
      expect(tick.state.frame).toBe(index + 1);
      for (const event of tick.events) expect(event.frame).toBe(index);
    });
    expect(ticks.filter((tick) => tick.events.length > 0).length).toBeGreaterThan(1);
  });
});

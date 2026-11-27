import { describe, expect, it } from 'vitest';
import {
  ARENA_WIDTH,
  createInitialState,
  createSimulationRunner,
  deserializeState,
  FIGHTER_WIDTH,
  serializeState,
  step,
  TICK_MS,
  WALK_SPEED,
} from '../src/index';
import { IDLE, P1_LEFT, P1_RIGHT, runFrames, walkCycleScript } from '../src/testing';

describe('simulation', () => {
  it('runs headlessly and moves player one by walk speed per tick', () => {
    const state = step(createInitialState(), P1_RIGHT);
    expect(state.frame).toBe(1);
    expect(state.fighters[0].x).toBe(createInitialState().fighters[0].x + WALK_SPEED);
    expect(state.fighters[1]).toEqual(createInitialState().fighters[1]);
  });

  it('keeps fighters inside the arena', () => {
    const left = runFrames(createInitialState(), () => P1_LEFT, 1000);
    const right = runFrames(createInitialState(), () => P1_RIGHT, 1000);
    expect(left.fighters[0].x).toBe(FIGHTER_WIDTH / 2);
    expect(right.fighters[0].x).toBe(ARENA_WIDTH - FIGHTER_WIDTH / 2);
  });

  it('produces identical states from identical inputs', () => {
    const a = runFrames(createInitialState(), walkCycleScript, 3600);
    const b = runFrames(createInitialState(), walkCycleScript, 3600);
    expect(a.frame).toBe(3600);
    expect(serializeState(a)).toBe(serializeState(b));
  });

  it('does not mutate the input state', () => {
    const initial = createInitialState();
    const snapshot = serializeState(initial);
    step(initial, P1_RIGHT);
    expect(serializeState(initial)).toBe(snapshot);
  });

  it('serializes and restores state so a resumed run matches an uninterrupted one', () => {
    const midway = runFrames(createInitialState(), walkCycleScript, 500);
    const restored = deserializeState(serializeState(midway));
    expect(restored).toEqual(midway);
    expect(runFrames(restored, walkCycleScript, 500)).toEqual(
      runFrames(createInitialState(), walkCycleScript, 1000),
    );
  });

  it('rejects malformed serialized state', () => {
    expect(() => deserializeState('{"frame":-1,"fighters":[]}')).toThrow();
    expect(() => deserializeState('{"frame":0,"fighters":[{"x":1.5},{"x":2}]}')).toThrow();
  });
});

describe('simulation runner', () => {
  it('runs one tick per whole tick interval of elapsed time', () => {
    const runner = createSimulationRunner();
    expect(runner.advance(TICK_MS * 3, IDLE)).toBe(3);
    expect(runner.advance(TICK_MS / 2, IDLE)).toBe(0);
    expect(runner.advance(TICK_MS / 2, IDLE)).toBe(1);
    expect(runner.state.frame).toBe(4);
  });

  it('caps catch-up after a long stall', () => {
    const runner = createSimulationRunner();
    expect(runner.advance(60_000, IDLE)).toBe(15);
  });

  it('pauses, single-steps, resumes and resets', () => {
    const runner = createSimulationRunner();
    runner.advance(TICK_MS * 2, IDLE);
    runner.pause();
    expect(runner.advance(TICK_MS * 5, IDLE)).toBe(0);
    runner.stepOnce(P1_RIGHT);
    expect(runner.state.frame).toBe(3);
    runner.resume();
    expect(runner.advance(TICK_MS, IDLE)).toBe(1);
    runner.reset();
    expect(runner.state).toEqual(createInitialState());
  });
});

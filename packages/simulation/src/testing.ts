// Public test fixtures (`@mortal-doctrine/simulation/testing`). For tests, benchmarks and labs;
// production code must not import this entry point.
import { InputBit, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import type { InputProvider } from './runner';
import type { InitialStateOptions, SimulationState } from './state';
import { step, type SimulationEvent } from './step';

/** ORs `InputBit`s into a raw frame: `held(InputBit.LEFT, InputBit.A1)`. */
export function held(...bits: number[]): InputFrame {
  return bits.reduce((frame, bit) => frame | bit, 0);
}

export const IDLE: FrameInputs = [0, 0];
export const P1_RIGHT: FrameInputs = [InputBit.RIGHT, 0];
export const P1_LEFT: FrameInputs = [InputBit.LEFT, 0];

/** Non-default seed and capacity, so tests notice anything that ignores the options. */
export const SEEDED_OPTIONS: InitialStateOptions = { seed: 0x9e37_79b9, historyCapacity: 8 };

/**
 * 90-frame cycle. Player one walks right 40 frames, idles 10, walks left 40. Player two walks
 * right 60 frames (reaching the right edge every cycle, so `boundary-contact` events occur),
 * holds left + right for 10 (no movement) and walks left 20; it presses A1 every third frame.
 */
export const walkCycleScript: InputProvider = (frame) => {
  const phase = frame % 90;
  const a1 = frame % 3 === 0 ? InputBit.A1 : 0;
  const p2 =
    phase < 60
      ? held(InputBit.RIGHT, a1)
      : phase < 70
        ? held(InputBit.LEFT, InputBit.RIGHT, a1)
        : held(InputBit.LEFT, a1);
  if (phase < 40) return [InputBit.RIGHT, p2];
  if (phase < 50) return [0, p2];
  return [InputBit.LEFT, p2];
};

/** Steps `count` frames, feeding the script the absolute frame number of each tick. */
export function runFrames(
  state: SimulationState,
  script: InputProvider,
  count: number,
): { state: SimulationState; events: SimulationEvent[] } {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < count; i++) {
    const result = step(state, script(state.frame));
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

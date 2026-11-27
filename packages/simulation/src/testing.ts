// Public test fixtures (`@mortal-doctrine/simulation/testing`). For tests, benchmarks and labs;
// production code must not import this entry point.
import { NEUTRAL_INPUT, type FrameInputs, type SimulationState } from './state';
import { step } from './step';

/** Maps an absolute simulation frame to the inputs applied on that frame. */
export type InputScript = (frame: number) => FrameInputs;

export const IDLE: FrameInputs = [NEUTRAL_INPUT, NEUTRAL_INPUT];
export const P1_RIGHT: FrameInputs = [{ left: false, right: true }, NEUTRAL_INPUT];
export const P1_LEFT: FrameInputs = [{ left: true, right: false }, NEUTRAL_INPUT];

/** 90-frame cycle: player one walks right 40 frames, idles 10, walks left 40. */
export const walkCycleScript: InputScript = (frame) => {
  const phase = frame % 90;
  if (phase < 40) return P1_RIGHT;
  if (phase < 50) return IDLE;
  return P1_LEFT;
};

/** Steps `count` frames, feeding the script the absolute frame number of each tick. */
export function runFrames(
  state: SimulationState,
  script: InputScript,
  count: number,
): SimulationState {
  for (let i = 0; i < count; i++) state = step(state, script(state.frame));
  return state;
}

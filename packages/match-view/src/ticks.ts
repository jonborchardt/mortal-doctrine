import type { InputProvider, SimulationEvent, SimulationState } from '@mortal-doctrine/simulation';
import type { Tick } from './presenter';

export interface TickSource {
  /** The given provider, noting the snapshot each tick starts from. Give this to the runner. */
  readonly inputs: InputProvider;
  /**
   * Runs `advance` (a runner `advance` or `stepOnce` fed `inputs`) and returns one tick per tick
   * it ran, oldest first, each with the events whose frame is the frame that tick started from.
   */
  run(advance: () => readonly SimulationEvent[]): Tick[];
}

/**
 * Splits a simulation runner's batch into per-tick `{ state, events }`: the runner returns one
 * list of events and only its latest snapshot. `getState` reads the runner's current snapshot.
 */
export function createTickSource(
  getState: () => SimulationState,
  inputs: InputProvider,
): TickSource {
  const before: SimulationState[] = [];
  return {
    inputs(frame) {
      before.push(getState());
      return inputs(frame);
    },
    run(advance) {
      before.length = 0;
      const events = advance();
      return before.map((previous, index) => ({
        state: before[index + 1] ?? getState(),
        events: events.filter((event) => event.frame === previous.frame),
      }));
    },
  };
}

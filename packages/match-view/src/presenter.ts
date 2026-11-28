import type { AnimatedPose } from '@mortal-doctrine/animation';
import { createCamera, type CameraConfig, type CameraOutput } from '@mortal-doctrine/camera';
import type { FighterState } from '@mortal-doctrine/movement';
import type { View } from '@mortal-doctrine/renderer';
import type { SimulationEvent, SimulationState } from '@mortal-doctrine/simulation';

/** One simulation tick: the snapshot after it and the events it emitted. */
export interface Tick {
  readonly state: SimulationState;
  readonly events: readonly SimulationEvent[];
}

/** What the host draws for one display frame. */
export interface DrawFrame {
  readonly state: SimulationState;
  /** Every event since the previous drawn frame, for the renderer's renderables (effects). */
  readonly events: readonly SimulationEvent[];
  readonly view: View;
  readonly poses: readonly [AnimatedPose, AnimatedPose];
}

export interface PresenterOptions {
  readonly camera: CameraConfig;
  /** The snapshot the timeline starts from: the camera rests there before the first tick. */
  readonly initial: SimulationState;
  /** A fighter's pose for a snapshot. Must be a function of its arguments only. */
  readonly pose: (fighter: FighterState, frame: number) => AnimatedPose;
  /** Receives each tick's events once, in tick order. */
  readonly audio: { play(events: readonly SimulationEvent[]): void };
  /** Sets the view and the poses, then renders. */
  readonly draw: (frame: DrawFrame) => void;
}

/**
 * The presentation order for one timeline (create a new one when the simulation restarts): the
 * camera and audio consume every tick, then the snapshot is drawn once through the camera's
 * view. Feeding the camera per tick keeps its output independent of display pacing.
 */
export function createPresenter({ camera: config, initial, pose, audio, draw }: PresenterOptions) {
  const camera = createCamera(config);
  // The camera's path must not depend on which snapshot happens to be drawn first.
  camera.update(initial);
  return {
    present(state: SimulationState, ticks: readonly Tick[]): CameraOutput {
      for (const tick of ticks) {
        camera.update(tick.state, tick.events);
        audio.play(tick.events);
      }
      // The same frame again returns the camera's last output.
      const output = camera.update(state);
      const [p1, p2] = state.fighters;
      draw({
        state,
        events: ticks.flatMap((tick) => tick.events),
        view: output.view,
        poses: [pose(p1, state.frame), pose(p2, state.frame)],
      });
      return output;
    },
  };
}

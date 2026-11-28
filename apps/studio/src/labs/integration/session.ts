// The Integration Lab's composition, without React, DOM or Pixi objects: the seeded fixture, a
// scripted input generator, the placeholder state-to-clip mapping, the record / playback session
// and the per-tick presentation order. The lab and the Node tests in `apps/studio/tests` both
// run this module, so the tests exercise the composition the lab shows.
import { loadClip, sample, type AnimatedPose } from '@mortal-doctrine/animation';
import { RAISE_STAFF, WALK_CYCLE } from '@mortal-doctrine/animation/testing';
import { parseArena } from '@mortal-doctrine/arena';
import { PLACEHOLDER_ARENA } from '@mortal-doctrine/arena/testing';
import { createCamera, type CameraConfig, type CameraOutput } from '@mortal-doctrine/camera';
import { FIXTURE_CAMERA_CONFIG } from '@mortal-doctrine/camera/testing';
import { GENERIC_COMMANDS } from '@mortal-doctrine/commands/testing';
import type { FighterState } from '@mortal-doctrine/movement';
import type { View } from '@mortal-doctrine/renderer';
import {
  createReplayPlayer,
  createReplayRecorder,
  hashState,
  type Replay,
  type ReplayDesync,
  type ReplayPlayer,
  type ReplayRecorder,
} from '@mortal-doctrine/replay';
import { InputBit, type InputFrame } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  createSimulationRunner,
  step,
  type InitialStateOptions,
  type InputProvider,
  type SimulationEvent,
  type SimulationRunner,
  type SimulationState,
} from '@mortal-doctrine/simulation';

/** The fixture every session starts from and Reset returns to. */
export const SEED = 1_180_199;
export const SESSION_OPTIONS = {
  seed: SEED,
  commands: GENERIC_COMMANDS,
} as const satisfies InitialStateOptions;

export const ARENA = parseArena(PLACEHOLDER_ARENA);
/**
 * The arena supplies the camera's visual bounds. The closest zoom is wider than the camera
 * fixture's: the camera does not track vertically, and at the fixture's 2 px per world unit a
 * jumping mannequin (head 365 world units up at the apex) leaves the top of the frame
 * (ticket #225). At 80000 sub-units across, 383 world units above the ground are visible.
 */
export const CAMERA_CONFIG: CameraConfig = {
  ...FIXTURE_CAMERA_CONFIG,
  bounds: ARENA.visualBounds,
  minVisibleWidth: 80_000,
};

const { LEFT, RIGHT, UP, DOWN, A1, A2 } = InputBit;
const SEGMENT_FRAMES = 12;
/** One held input per segment; the quarter circle is spelled out over a segment's frames. */
const ACTIONS: readonly ((phase: number) => InputFrame)[] = [
  () => 0,
  () => LEFT,
  () => LEFT,
  () => RIGHT,
  () => RIGHT,
  () => UP,
  () => UP | LEFT,
  () => UP | RIGHT,
  () => DOWN,
  () => A2,
  (phase) => (phase < 3 ? DOWN : phase < 6 ? DOWN | RIGHT : phase === 6 ? RIGHT | A1 : RIGHT),
];

/** FNV-1a with a final avalanche, as the presentation packages use for their fixed choices. */
function mix(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) h = Math.imul(h ^ value, 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Seeded inputs for both players: walks, jumps, crouches, button presses and quarter circles in
 * 12-frame segments. A pure function of the seed and the frame, so a restored run can ask for
 * any frame's inputs again.
 */
export function scriptedInputs(seed: number): InputProvider {
  const player = (index: number, frame: number): InputFrame => {
    const segment = Math.floor(frame / SEGMENT_FRAMES);
    const action = ACTIONS[mix(seed, index, segment) % ACTIONS.length]!;
    return action(frame % SEGMENT_FRAMES);
  };
  return (frame) => [player(0, frame), player(1, frame)];
}

const WALK = loadClip(WALK_CYCLE);
const RAISE = loadClip(RAISE_STAFF);
const REST: AnimatedPose = {};
const CROUCH: AnimatedPose = { bones: { root: { scale: { x: 1, y: 0.6 } } } };

export type FighterActivity = 'idle' | 'walk' | 'crouch' | 'air';

export function fighterActivity(fighter: FighterState): FighterActivity {
  if (!fighter.grounded) return 'air';
  if (fighter.crouching) return 'crouch';
  return fighter.vx === 0 ? 'idle' : 'walk';
}

/**
 * Placeholder mapping from movement state to a mannequin pose: the walk cycle on the simulation
 * frame while walking, the raised staff in the air, a squash while crouching, the rest pose
 * otherwise. A function of the snapshot only. Not an animation state machine.
 */
export function fighterPose(fighter: FighterState, frame: number): AnimatedPose {
  switch (fighterActivity(fighter)) {
    case 'walk':
      return sample(WALK, frame);
    case 'air':
      return sample(RAISE, RAISE.duration);
    case 'crouch':
      return CROUCH;
    case 'idle':
      return REST;
  }
}

/** One simulation tick: the snapshot after it and the events it emitted. */
export interface Tick {
  readonly state: SimulationState;
  readonly events: readonly SimulationEvent[];
}

/**
 * The events of the `count` replay ticks after `from`, found by stepping again: the replay
 * player re-simulates but does not hand out the events (ticket #220).
 */
export function replayTicks(replay: Replay, from: SimulationState, count: number): Tick[] {
  const ticks: Tick[] = [];
  let state = from;
  for (let i = 0; i < count; i++) {
    const inputs = replay.inputs[state.frame];
    if (!inputs) break;
    const result = step(state, inputs);
    state = result.state;
    ticks.push(result);
  }
  return ticks;
}

/** The last frame of a recording, or of its playback. */
export interface FinalFrame {
  readonly frame: number;
  readonly hash: string;
}

export interface Session {
  readonly mode: 'live' | 'recording' | 'playback';
  readonly state: SimulationState;
  readonly paused: boolean;
  /** The finished recording, until Record or Reset. */
  readonly replay: Replay | null;
  /** Where the recording ended. */
  readonly recorded: FinalFrame | null;
  /** Where the playback ended; null until it reaches the last frame. */
  readonly played: FinalFrame | null;
  readonly desync: ReplayDesync | null;
  setPaused(paused: boolean): void;
  /** Feeds host display time; returns the ticks run, oldest first. */
  advance(elapsedMs: number): Tick[];
  /** Runs one tick regardless of pause. */
  step(): Tick[];
  /** Restarts from the fixture, running, recording every tick. */
  record(): void;
  /** Ends the recording and pauses on its last frame. */
  stop(): void;
  /** Plays the recording from frame 0. */
  playReplay(): void;
  /** Back to the fixture, paused, with no recording. */
  reset(): void;
}

/** A live, recordable and replayable simulation session. `inputs` is asked once per live tick. */
export function createSession(inputs: InputProvider): Session {
  let runner: SimulationRunner = createSimulationRunner(SESSION_OPTIONS);
  runner.pause();
  let recorder: ReplayRecorder | null = null;
  let replay: Replay | null = null;
  let recorded: FinalFrame | null = null;
  let player: ReplayPlayer | null = null;
  let played: FinalFrame | null = null;

  // The runner returns one batch of events; the snapshot before each tick is caught here.
  const before: SimulationState[] = [];
  const sampled: InputProvider = (frame) => {
    before.push(runner.state);
    return inputs(frame);
  };
  let provider = sampled;
  const start = (record: boolean) => {
    runner = createSimulationRunner(SESSION_OPTIONS);
    recorder = record
      ? createReplayRecorder({ options: SESSION_OPTIONS, getState: () => runner.state })
      : null;
    provider = recorder ? recorder.provider(sampled) : sampled;
    replay = null;
    recorded = null;
    player = null;
    played = null;
  };
  const final = (state: SimulationState): FinalFrame => ({
    frame: state.frame,
    hash: hashState(state),
  });

  const live = (run: () => readonly SimulationEvent[]): Tick[] => {
    before.length = 0;
    const events = run();
    // An event's frame is the frame its tick started from.
    return before.map((previous, index) => ({
      state: before[index + 1] ?? runner.state,
      events: events.filter((event) => event.frame === previous.frame),
    }));
  };
  const playback = (current: ReplayPlayer, run: () => number): Tick[] => {
    const from = current.state;
    const ticks = replay ? replayTicks(replay, from, run()) : [];
    if (!played && current.frame === current.length && !current.desync)
      played = final(current.state);
    return ticks;
  };

  return {
    get mode() {
      return player ? 'playback' : recorder ? 'recording' : 'live';
    },
    get state() {
      return player?.state ?? runner.state;
    },
    get paused() {
      return player?.paused ?? runner.paused;
    },
    get replay() {
      return replay;
    },
    get recorded() {
      return recorded;
    },
    get played() {
      return played;
    },
    get desync() {
      return player?.desync ?? null;
    },
    setPaused(paused) {
      const target = player ?? runner;
      if (paused) target.pause();
      else if (player) player.play();
      else runner.resume();
    },
    advance(elapsedMs) {
      const current = player;
      return current
        ? playback(current, () => current.advance(elapsedMs))
        : live(() => runner.advance(elapsedMs, provider).events);
    },
    step() {
      const current = player;
      return current
        ? playback(current, () => Number(current.stepOnce()))
        : live(() => runner.stepOnce(provider));
    },
    record: () => start(true),
    stop() {
      if (!recorder) return;
      // Dropped before `finish` can throw: an unfinishable recording cannot be continued either.
      const finished = recorder;
      recorder = null;
      provider = sampled;
      runner.pause();
      replay = finished.finish();
      recorded = final(runner.state);
    },
    playReplay() {
      if (!replay) return;
      player = createReplayPlayer(replay);
      played = null;
      player.play();
    },
    reset() {
      start(false);
      runner.pause();
    },
  };
}

/** What the host draws for one display frame. */
export interface DrawFrame {
  readonly state: SimulationState;
  /** Every event since the previous drawn frame, for the renderer's renderables (effects). */
  readonly events: readonly SimulationEvent[];
  readonly view: View;
  readonly poses: readonly [AnimatedPose, AnimatedPose];
}

export interface PresenterHost {
  /** Receives each tick's events once, in tick order. */
  readonly audio: { play(events: readonly SimulationEvent[]): void };
  /** Sets the view and the poses, then renders. */
  draw(frame: DrawFrame): void;
}

/**
 * The presentation order for one timeline (create a new one when the session restarts): the
 * camera and audio consume every tick, then the snapshot is drawn once through the camera's
 * view. Feeding the camera per tick keeps its output independent of display pacing.
 */
export function createPresenter(host: PresenterHost) {
  const camera = createCamera(CAMERA_CONFIG);
  // Every timeline starts at the fixture: the camera rests there before the first tick, so its
  // path does not depend on which snapshot happens to be drawn first.
  camera.update(createInitialState(SESSION_OPTIONS));
  return {
    present(state: SimulationState, ticks: readonly Tick[]): CameraOutput {
      for (const tick of ticks) {
        camera.update(tick.state, tick.events);
        host.audio.play(tick.events);
      }
      // The same frame again returns the camera's last output.
      const output = camera.update(state);
      const [p1, p2] = state.fighters;
      host.draw({
        state,
        events: ticks.flatMap((tick) => tick.events),
        view: output.view,
        poses: [fighterPose(p1, state.frame), fighterPose(p2, state.frame)],
      });
      return output;
    },
  };
}

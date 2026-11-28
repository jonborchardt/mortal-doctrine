import { createAudioPlayer, DEDUPE_WINDOW_FRAMES, type TriggeredCue } from '@mortal-doctrine/audio';
import {
  createFakeAudioContext,
  createToneBuffers,
  FakeGestureTarget,
  FIXTURE_CUES,
} from '@mortal-doctrine/audio/testing';
import type { CameraOutput } from '@mortal-doctrine/camera';
import { createEffectsRenderable } from '@mortal-doctrine/effects';
import { CORE_EFFECTS, CORE_MAPPING } from '@mortal-doctrine/effects/testing';
import { createPresenter, type DrawFrame, type Tick } from '@mortal-doctrine/match-view';
import { PRESENTATION, SEED } from '@mortal-doctrine/match-view/testing';
import { createReplayPlayer } from '@mortal-doctrine/replay';
import type { SimulationState } from '@mortal-doctrine/simulation';
import { expect, it } from 'vitest';
import { createSession, replayTicks, scriptedInputs } from '../src/labs/integration/session';

// 25 simulated seconds: longer than the effects and audio dedupe windows (600 frames).
const FRAMES = 1500;

/**
 * The lab's presentation without a canvas or speakers: the production camera (inside the
 * presenter), the production effects renderable fed as the renderer would feed it, and the
 * production audio player on a fake context. Logs what each presented frame produced.
 */
function createHeadless() {
  const effects = createEffectsRenderable({ definitions: CORE_EFFECTS, mapping: CORE_MAPPING });
  const context = createFakeAudioContext();
  const gestures = new FakeGestureTarget();
  const audio = createAudioPlayer({
    context,
    cues: FIXTURE_CUES,
    buffers: createToneBuffers(context),
    gestureTarget: gestures,
  });
  gestures.dispatchEvent(new Event('pointerdown'));
  expect(audio.state).toBe('unlocked');

  const cameras: CameraOutput[] = [];
  const poses: DrawFrame['poses'][] = [];
  /** Per presented frame: the effects spawned by it, as `id key`. */
  const spawned: string[][] = [];
  /** Per presented frame: the cues triggered by it. */
  const cues: TriggeredCue[][] = [];
  const active = () => effects.active.map(({ id, key }) => `${id} ${key}`);
  let lastFrame = -1;

  const presenter = createPresenter({
    ...PRESENTATION,
    audio,
    draw({ state, events, view, poses: drawn }) {
      // A lower frame clears the effects, so nothing drawn before it counts as known.
      const known = new Set(state.frame < lastFrame ? [] : active());
      lastFrame = state.frame;
      effects.update({ state, previous: undefined, alpha: 0, events, view });
      spawned.push(active().filter((effect) => !known.has(effect)));
      poses.push(drawn);
    },
  });

  return {
    cameras,
    poses,
    spawned,
    cues,
    active,
    context,
    present(state: SimulationState, ticks: readonly Tick[]) {
      const started = context.sources.length;
      cameras.push(presenter.present(state, ticks));
      const { log } = audio;
      cues.push(log.slice(log.length - (context.sources.length - started)));
    },
  };
}

it('a recorded session replays with the same camera, effects, cues and poses', () => {
  const session = createSession(scriptedInputs(SEED));
  session.record();
  const live = createHeadless();
  for (let frame = 0; frame < FRAMES; frame++) {
    const ticks = session.step();
    live.present(session.state, ticks);
  }
  session.stop();
  expect(session.recorded?.frame).toBe(FRAMES);

  // The run produced something to compare, and every effect and cue exactly once.
  const liveEffects = live.spawned.flat();
  expect(liveEffects.length).toBeGreaterThan(100);
  expect(new Set(liveEffects).size).toBe(liveEffects.length);
  expect(live.cues.flat().length).toBe(live.context.sources.length);
  expect(new Set(live.cues.flat().map((cue) => cue.cue))).toEqual(
    new Set(FIXTURE_CUES.map((cue) => cue.id)),
  );
  expect(live.cameras.some(({ shake }) => shake.x !== 0 || shake.y !== 0)).toBe(true);

  // Playback through the session, with a new presentation as the lab makes for a new timeline.
  session.playReplay();
  const playback = createHeadless();
  while (!session.played) {
    const ticks = session.step();
    expect(ticks).toHaveLength(1);
    playback.present(session.state, ticks);
  }
  expect(session.desync).toBeNull();
  expect(session.played).toEqual(session.recorded);
  expect(playback.cameras).toEqual(live.cameras);
  expect(playback.spawned).toEqual(live.spawned);
  expect(playback.cues).toEqual(live.cues);
  expect(playback.poses).toEqual(live.poses);

  // A seek back inside the dedupe windows, then re-simulation into the same presentation: the
  // cleared effects come back once each and no cue plays again.
  const replay = session.replay;
  if (!replay) throw new Error('the session kept no recording');
  const back = FRAMES - DEDUPE_WINDOW_FRAMES / 2;
  const player = createReplayPlayer(replay);
  player.seek(back);
  const sources = playback.context.sources.length;
  playback.present(player.state, []);
  expect(playback.active()).toEqual([]);
  const again = replayTicks(replay, player.state, FRAMES - back);
  expect(again).toHaveLength(FRAMES - back);
  for (const tick of again) playback.present(tick.state, [tick]);
  const expected = live.spawned.slice(back).flat();
  expect(expected.length).toBeGreaterThan(10);
  expect(playback.active()).toEqual(expected);
  expect(playback.context.sources.length).toBe(sources);

  // The last tick delivered a second time changes nothing.
  const last = again.at(-1);
  if (!last) throw new Error('no tick was re-simulated');
  playback.present(last.state, [last]);
  expect(playback.active()).toEqual(expected);
  expect(playback.context.sources.length).toBe(sources);
  expect(playback.cameras.at(-1)).toEqual(playback.cameras.at(-2));
});

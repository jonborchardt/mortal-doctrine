// The game screen's match, outside React: device capture, the simulation runner, the audio
// player and the per-frame loop on the `@mortal-doctrine/match-view` stage. Loaded lazily by
// `App.tsx`, so PixiJS ships as its own chunk.
import { createAudioPlayer, type TriggeredCue } from '@mortal-doctrine/audio';
import { createInputCapture, DEFAULT_PLAYER_BINDINGS } from '@mortal-doctrine/input';
import { createPresenter, createTickSource, mountMatchStage } from '@mortal-doctrine/match-view';
// No content packages exist yet (ticket #226): the game shows the placeholder match fixture.
// The one production import of a `testing` entry; see `docs/testing.md`.
import {
  PRESENTATION,
  SESSION_OPTIONS,
  STAGE,
  toneAudio,
} from '@mortal-doctrine/match-view/testing';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import { createSimulationRunner } from '@mortal-doctrine/simulation';

/**
 * Starts the match in `host`, writing the HUD into the `[data-readout]` nodes of `root` directly
 * every display frame. Returns its teardown, which releases the captures, the audio
 * player, the frame subscription and the renderer. `onError` hears a stage that failed to load.
 */
export function startMatch(
  host: HTMLElement,
  root: HTMLElement,
  onError: (cause: unknown) => void,
): () => void {
  const mount = mountMatchStage(host, STAGE);
  let teardown = () => {};
  const readouts = new Map(
    [...root.querySelectorAll<HTMLElement>('[data-readout]')].map((el) => [el.dataset.readout, el]),
  );
  const write = (key: string, text: string) => {
    const element = readouts.get(key);
    if (element && element.textContent !== text) element.textContent = text;
  };

  mount.ready
    .then((stage) => {
      if (!stage) return;
      const { renderer, effects } = stage;
      const captures = [
        createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
        createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
      ] as const;
      const runner = createSimulationRunner(SESSION_OPTIONS);
      // Sampled once per simulation tick, so taps shorter than a tick are not lost.
      const ticks = createTickSource(
        () => runner.state,
        () => [captures[0].sample(), captures[1].sample()],
      );
      // Locked until the first key or pointer press on the page.
      const audio = createAudioPlayer({
        ...toneAudio(new AudioContext()),
        gestureTarget: window,
      });
      const presenter = createPresenter({ ...PRESENTATION, audio, draw: stage.draw });

      // Counted as they appear: the effects list and the audio log both forget old entries.
      let activeEffects = new Set<string>();
      let effectsSpawned = 0;
      const countedCues = new WeakSet<TriggeredCue>();
      let cuesPlayed = 0;

      const unsubscribe = renderer.onFrame((elapsedMs) => {
        const advanced = ticks.run(() => runner.advance(elapsedMs, ticks.inputs).events);
        effects.advance(elapsedMs);
        const { state } = runner;
        presenter.present(state, advanced);

        const keys = new Set(effects.active.map(({ key }) => key));
        for (const key of keys) if (!activeEffects.has(key)) effectsSpawned += 1;
        activeEffects = keys;
        for (const cue of audio.log) {
          if (countedCues.has(cue)) continue;
          countedCues.add(cue);
          cuesPlayed += 1;
        }

        write('frame', String(state.frame));
        write('fps', String(Math.round(renderer.fps)));
        write('p1-x', String(state.fighters[0].x / SUBUNITS_PER_UNIT));
        write('effects-spawned', String(effectsSpawned));
        write('audio-cues', String(cuesPlayed));
      });

      teardown = () => {
        unsubscribe();
        for (const capture of captures) capture.dispose();
        audio.dispose();
      };
    })
    .catch(onError);

  return () => {
    teardown();
    mount.dispose();
  };
}

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

/** HUD text nodes, written directly every display frame. */
export type Hud = Readonly<
  Record<'frame' | 'fps' | 'p1x' | 'effects' | 'cues', HTMLElement | null>
>;

function setText(element: HTMLElement | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

/**
 * Starts the match in `host`. Returns its teardown, which releases the captures, the audio
 * player, the frame subscription and the renderer. `onError` hears a stage that failed to load.
 */
export function startMatch(
  host: HTMLElement,
  hud: Hud,
  onError: (cause: unknown) => void,
): () => void {
  const mount = mountMatchStage(host, STAGE);
  let teardown = () => {};

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
      let lastCue: TriggeredCue | undefined;
      let cuesPlayed = 0;

      const unsubscribe = renderer.onFrame((elapsedMs) => {
        const advanced = ticks.run(() => runner.advance(elapsedMs, ticks.inputs).events);
        effects.advance(elapsedMs);
        const { state } = runner;
        presenter.present(state, advanced);

        const keys = new Set(effects.active.map(({ key }) => key));
        for (const key of keys) if (!activeEffects.has(key)) effectsSpawned += 1;
        activeEffects = keys;
        const { log } = audio;
        // The log is oldest first: everything after the last cue counted is new.
        cuesPlayed += log.length - 1 - (lastCue ? log.lastIndexOf(lastCue) : -1);
        lastCue = log.at(-1);

        setText(hud.frame, String(state.frame));
        setText(hud.fps, String(Math.round(renderer.fps)));
        setText(hud.p1x, String(state.fighters[0].x / SUBUNITS_PER_UNIT));
        setText(hud.effects, String(effectsSpawned));
        setText(hud.cues, String(cuesPlayed));
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

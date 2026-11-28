import { useEffect, useRef, useState } from 'react';
import { createAudioPlayer, type AudioPlayer } from '@mortal-doctrine/audio';
import { visibleSpan } from '@mortal-doctrine/camera';
import { createInputCapture, DEFAULT_PLAYER_BINDINGS } from '@mortal-doctrine/input';
import { createPresenter, mountMatchStage, type Tick } from '@mortal-doctrine/match-view';
import {
  CAMERA_CONFIG,
  fighterActivity,
  PRESENTATION,
  SEED,
  STAGE,
  toneAudio,
} from '@mortal-doctrine/match-view/testing';
import { TICK_MS } from '@mortal-doctrine/sim-core';
import { createSession, type FinalFrame, type Session } from './session';

const { viewport } = CAMERA_CONFIG;
const GESTURES = ['pointerdown', 'keydown'] as const;
const CUE_LINES = 5;

/** What the controls need to know; everything per-frame is written straight to the DOM. */
interface Controls {
  readonly mode: Session['mode'];
  readonly paused: boolean;
  readonly hasReplay: boolean;
}
const INITIAL_CONTROLS: Controls = { mode: 'live', paused: true, hasReplay: false };

/** Control actions, created with the session inside the effect. */
interface Actions {
  togglePause(): void;
  step(): void;
  reset(): void;
  record(): void;
  stop(): void;
  playReplay(): void;
}

const formatFinal = (final: FinalFrame | null) => final?.hash ?? '—';

export function IntegrationLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [ready, setReady] = useState(false);
  const [controls, setControls] = useState(INITIAL_CONTROLS);
  const [alert, setAlert] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    let disposed = false;
    let teardown = () => {};
    const mount = mountMatchStage(host, STAGE);

    mount.ready
      .then((stage) => {
        if (!stage) return;
        const { renderer, effects } = stage;

        const captures = [
          createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
          createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
        ] as const;
        // One sample per player per tick, as the simulation (and the recorder) receives it.
        const session = createSession(() => [captures[0].sample(), captures[1].sample()]);

        // The audio player forgets nothing on request, so each timeline gets a new one, or the
        // cues of a replayed frame would be deduplicated away (ticket #221). A new player is
        // locked until a gesture: the page's gestures are relayed to it, the first one at once.
        const gestures = new EventTarget();
        let unlocked = false;
        const relayGesture = () => {
          unlocked = true;
          gestures.dispatchEvent(new Event('pointerdown'));
        };
        for (const type of GESTURES) window.addEventListener(type, relayGesture);
        const createAudio = () => {
          const context = new AudioContext();
          const player = createAudioPlayer({ ...toneAudio(context), gestureTarget: gestures });
          if (unlocked) gestures.dispatchEvent(new Event('pointerdown'));
          return player;
        };

        let audio: AudioPlayer | undefined;
        let presenter: ReturnType<typeof createPresenter>;
        // Ticks run by Step, presented with the next display frame.
        let pending: Tick[] = [];
        // Keys of the effects seen on this timeline; a key names one simulation event.
        const spawned = new Set<string>();
        let lastEffect = '—';
        /** A new timeline from the fixture: nothing presented before it carries over. */
        const restart = () => {
          audio?.dispose();
          audio = createAudio();
          const player = audio;
          presenter = createPresenter({ ...PRESENTATION, audio: player, draw: stage.draw });
          effects.clear();
          spawned.clear();
          lastEffect = '—';
          pending = [];
        };
        restart();

        const replayFromStart = () => {
          session.playReplay();
          restart();
        };
        // A finished (or desynced) playback cannot continue: Play and Step start it over.
        const ended = () =>
          session.mode === 'playback' && (session.played !== null || session.desync !== null);

        actionsRef.current = {
          togglePause() {
            if (ended()) replayFromStart();
            else session.setPaused(!session.paused);
          },
          step() {
            if (ended()) {
              replayFromStart();
              session.setPaused(true);
            }
            pending.push(...session.step());
          },
          reset() {
            session.reset();
            restart();
          },
          record() {
            session.record();
            restart();
          },
          stop: () => session.stop(),
          playReplay: replayFromStart,
        };

        const readouts = new Map(
          [...root.querySelectorAll<HTMLElement>('[data-readout]')].map((el) => [
            el.dataset.readout,
            el,
          ]),
        );
        const write = (key: string, text: string) => {
          const element = readouts.get(key);
          if (element && element.textContent !== text) element.textContent = text;
        };

        // Measured tick rate over a rolling one-second window of display time.
        let windowMs = 0;
        let windowTicks = 0;
        let shownControls = '';

        // Per-frame work stays outside React; React only hears about control changes.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          const started = performance.now();
          const advanced = session.advance(elapsedMs);
          const simMs = performance.now() - started;
          const ticks = pending.length ? [...pending, ...advanced] : advanced;
          pending = [];
          // Effects age by display time; paused, only stepped ticks age them.
          effects.advance(session.paused ? ticks.length * TICK_MS : elapsedMs);
          const { state } = session;
          const { view } = presenter.present(state, ticks);

          for (const { id, key } of effects.active) {
            if (spawned.has(key)) continue;
            spawned.add(key);
            lastEffect = id;
          }
          windowMs += elapsedMs;
          windowTicks += advanced.length;
          if (windowMs >= 1000) {
            write('tps', String(Math.round((windowTicks * 1000) / windowMs)));
            windowMs = 0;
            windowTicks = 0;
          }

          const { mode, paused, replay, recorded, played, desync } = session;
          write('mode', desync ? 'desync' : mode);
          write('frame', String(state.frame));
          state.fighters.forEach((fighter, index) => {
            write(`p${index + 1}-x`, String(fighter.x));
            write(`p${index + 1}-y`, String(fighter.y));
            write(`p${index + 1}-state`, fighterActivity(fighter));
          });
          write('effects-active', String(effects.active.length));
          write('effects-spawned', String(spawned.size));
          write('effects-last', lastEffect);
          const log = audio?.log ?? [];
          write('audio-state', audio?.state ?? '—');
          write('cues', String(log.length));
          write(
            'cue-log',
            log
              .slice(-CUE_LINES)
              .map(({ frame, type, cue }) => `frame ${frame} · ${type} → ${cue}`)
              .join('\n'),
          );
          const span = visibleSpan(view, viewport.width);
          write('camera-left', String(Math.round(span.left)));
          write('camera-right', String(Math.round(span.right)));
          write('recorded-frame', String(recorded?.frame ?? '—'));
          write('recorded-hash', formatFinal(recorded));
          write('played-frame', String(played?.frame ?? '—'));
          write('played-hash', formatFinal(played));
          write('fps', String(Math.round(renderer.fps)));
          write('sim-ms', simMs.toFixed(3));
          write('frame-ms', renderer.frameCpuMs.toFixed(2));

          // Playback pauses itself at its last frame, so the loop reports control changes.
          const next: Controls = { mode, paused, hasReplay: replay !== null };
          const key = JSON.stringify(next);
          if (key !== shownControls) {
            shownControls = key;
            setControls(next);
          }
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          for (const type of GESTURES) window.removeEventListener(type, relayGesture);
          for (const capture of captures) capture.dispose();
          audio?.dispose();
          actionsRef.current = null;
        };
      })
      .catch((cause: unknown) => {
        console.error(cause);
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      disposed = true;
      teardown();
      mount.dispose();
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  // Every control clears the alert, so a failure message never outlives the next action.
  const run = (name: string, action: (actions: Actions) => void) => () => {
    const actions = actionsRef.current;
    if (!actions) return;
    setAlert(null);
    try {
      action(actions);
    } catch (cause) {
      console.error(cause);
      setAlert(`${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const { mode, paused, hasReplay } = controls;
  const recording = mode === 'recording';
  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const button = (name: string, enabled: boolean, action: (actions: Actions) => void) => (
    <button
      type="button"
      className={buttonClass}
      disabled={!ready || !enabled}
      onClick={run(name, action)}
    >
      {name}
    </button>
  );
  const readout = (label: string, key: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={`integration-${key}`} data-readout={key} />
    </>
  );

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Integration Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="integration-frame" data-readout="frame" /> · Seed{' '}
          <span data-testid="integration-seed">{SEED}</span> ·{' '}
          <span data-testid="integration-mode" data-readout="mode" aria-live="polite" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {button('Reset', !recording, (actions) => actions.reset())}
        {button(paused ? 'Play' : 'Pause', true, (actions) => actions.togglePause())}
        {button('Step', paused, (actions) => actions.step())}
        {/* One button, so keyboard focus stays on it when it changes from Record to Stop. */}
        {button(recording ? 'Stop' : 'Record', true, (actions) =>
          recording ? actions.stop() : actions.record(),
        )}
        {button('Play replay', hasReplay, (actions) => actions.playReplay())}
      </div>
      {alert && (
        <p role="alert" className="text-sm text-red-400">
          {alert}
        </p>
      )}
      <div
        ref={hostRef}
        data-testid="arena"
        role="img"
        aria-label="Two mannequin fighters in the placeholder arena"
        aria-describedby="integration-diagnostics"
        className="w-full max-w-[960px]"
      />
      <h2 id="integration-diagnostics" className="text-sm text-neutral-400">
        Diagnostics (world values in sub-units, 100 per world unit)
      </h2>
      <dl
        role="group"
        aria-labelledby="integration-diagnostics"
        className="grid w-fit grid-cols-[auto_auto_auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        {readout('P1 x', 'p1-x')}
        {readout('P2 x', 'p2-x')}
        {readout('P1 y', 'p1-y')}
        {readout('P2 y', 'p2-y')}
        {readout('P1 state', 'p1-state')}
        {readout('P2 state', 'p2-state')}
        {readout('Active effects', 'effects-active')}
        {readout('Effects spawned', 'effects-spawned')}
        {readout('Last effect', 'effects-last')}
        {readout('Audio', 'audio-state')}
        {readout('Visible left', 'camera-left')}
        {readout('Visible right', 'camera-right')}
        {readout('Recorded final frame', 'recorded-frame')}
        {readout('Recorded final hash', 'recorded-hash')}
        {readout('Playback final frame', 'played-frame')}
        {readout('Playback final hash', 'played-hash')}
        {readout('Render FPS', 'fps')}
        {readout('Ticks / s', 'tps')}
        {readout('Frame CPU (ms)', 'frame-ms')}
        {readout('Simulation update (ms)', 'sim-ms')}
      </dl>
      <h2 id="integration-cues" className="text-sm text-neutral-400">
        Triggered audio cues: <span data-testid="integration-cues" data-readout="cues" /> (the
        player keeps 64; newest {CUE_LINES} shown)
      </h2>
      <pre
        role="region"
        aria-labelledby="integration-cues"
        data-testid="integration-cue-log"
        data-readout="cue-log"
        className="min-h-20 font-mono text-xs text-neutral-400"
      />
      <p className="text-sm text-neutral-400">
        Every M1 system from its production package: device capture, command recognition and
        movement through <code>step</code>, two mannequin rigs posed by placeholder clips and drawn
        by the skeletal renderer, the camera, the placeholder arena, and effects and audio driven by
        simulation events. Player 1: A / D or ← → to walk, W or ↑ to jump, S or ↓ to crouch, U I O J
        K L for buttons. Player 2: numpad 4 / 6 / 8 / 5 and digits 1 to 6, or the first gamepad.
        Reset returns to the seeded fixture, paused at frame 0. Record restarts from the fixture,
        discards any earlier recording and records live input (Reset is unavailable meanwhile); Stop
        keeps the recording; Play replay re-simulates it from frame 0 and must end on the recorded
        frame and hash. After a playback has ended, Play and Step start it again from frame 0. Audio
        plays after the first key or pointer press.
      </p>
      {error && (
        <p role="alert" className="text-red-400">
          Integration failed: {error}
        </p>
      )}
    </section>
  );
}

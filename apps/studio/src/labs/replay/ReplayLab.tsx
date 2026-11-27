import { useEffect, useRef, useState } from 'react';
import { createInputCapture, DEFAULT_PLAYER_BINDINGS } from '@mortal-doctrine/input';
import { createArenaRenderer } from '@mortal-doctrine/renderer';
import {
  createReplayPlayer,
  createReplayRecorder,
  deserializeReplay,
  serializeReplay,
  type Replay,
  type ReplayPlayer,
  type ReplayRecorder,
} from '@mortal-doctrine/replay';
import {
  createInitialState,
  createSimulationRunner,
  type InitialStateOptions,
  type InputProvider,
  type SimulationRunner,
} from '@mortal-doctrine/simulation';

// Deterministic fixture the lab starts from; Record and Reset return to it.
const LAB_OPTIONS = { seed: 12345 } as const satisfies InitialStateOptions;
const INITIAL_STATE = createInitialState(LAB_OPTIONS);

/** What the controls need to know; everything per-frame is written straight to the DOM. */
interface View {
  readonly mode: 'idle' | 'recording' | 'playback';
  /** Length of the loaded replay, for the seek range. */
  readonly length: number;
}

const IDLE: View = { mode: 'idle', length: 0 };

/** Control actions, created with the session inside the effect. Each returns the new view. */
interface Actions {
  record(): View;
  stop(): View;
  play(): View;
  pause(): View;
  step(): View;
  seek(frame: number): View;
  exportJson(): View;
  /** Throws, leaving the current replay in place, when the text is not a valid replay. */
  importJson(): View;
  reset(): View;
}

export function ReplayLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(IDLE);
  const [importError, setImportError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    const seekInput = seekRef.current;
    const json = jsonRef.current;
    if (!host || !root || !seekInput || !json) return;
    let disposed = false;
    let teardown = () => {};

    createArenaRenderer(host)
      .then((renderer) => {
        if (disposed) return renderer.destroy();
        const players = [
          createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
          createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
        ] as const;
        // At most one of `recording` and `player` is set; neither is idle.
        let recording: {
          readonly runner: SimulationRunner;
          readonly recorder: ReplayRecorder;
          readonly provider: InputProvider;
        } | null = null;
        let replay: Replay | null = null;
        let player: ReplayPlayer | null = null;

        const load = (next: Replay) => {
          const nextPlayer = createReplayPlayer(next);
          recording = null;
          replay = next;
          player = nextPlayer;
          return nextPlayer;
        };
        const current = (): View =>
          recording
            ? { mode: 'recording', length: 0 }
            : player
              ? { mode: 'playback', length: player.length }
              : IDLE;

        actionsRef.current = {
          record() {
            const runner = createSimulationRunner(LAB_OPTIONS);
            const recorder = createReplayRecorder({
              options: LAB_OPTIONS,
              getState: () => runner.state,
            });
            // One sample per player per tick, recorded exactly as the simulation receives it.
            const provider = recorder.provider(() => [players[0].sample(), players[1].sample()]);
            replay = null;
            player = null;
            recording = { runner, recorder, provider };
            return current();
          },
          stop() {
            // Show the recorded final frame; Play starts over from frame 0.
            if (recording) {
              const recorded = load(recording.recorder.finish());
              recorded.seek(recorded.length);
            }
            return current();
          },
          play() {
            if (player && player.frame === player.length && !player.desync) player.seek(0);
            player?.play();
            return current();
          },
          pause() {
            player?.pause();
            return current();
          },
          step() {
            player?.pause();
            player?.stepOnce();
            return current();
          },
          seek(frame) {
            player?.seek(frame);
            return current();
          },
          exportJson() {
            if (replay) json.value = serializeReplay(replay);
            return current();
          },
          importJson() {
            load(deserializeReplay(json.value));
            return current();
          },
          reset() {
            recording = null;
            replay = null;
            player = null;
            return current();
          },
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

        // Per-frame work stays outside React; React only handles control clicks.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          if (recording) recording.runner.advance(elapsedMs, recording.provider);
          else player?.advance(elapsedMs);
          const state = recording?.runner.state ?? player?.state ?? INITIAL_STATE;
          renderer.render(state);

          const frame = String(state.frame);
          write(
            'mode',
            recording ? 'recording' : player ? (player.paused ? 'paused' : 'playing') : 'idle',
          );
          write('frame', frame);
          write('length', String(recording?.recorder.length ?? player?.length ?? 0));
          write('x', String(state.fighters[0].x));
          const desync = player?.desync;
          write(
            'desync',
            desync
              ? `frame ${desync.frame}: state ${desync.actual.stateHash} (recorded ${desync.expected.stateHash}), ` +
                  `inputs ${desync.actual.inputsHash} (recorded ${desync.expected.inputsHash})`
              : 'none',
          );
          if (seekInput.value !== frame) seekInput.value = frame;
        });

        setReady(true);
        teardown = () => {
          unsubscribe();
          for (const capture of players) capture.dispose();
          renderer.destroy();
          actionsRef.current = null;
        };
      })
      .catch((cause: unknown) => {
        console.error(cause);
        setError(String(cause));
      });

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const run = (action: (actions: Actions) => View) => () => {
    const actions = actionsRef.current;
    if (actions) setView(action(actions));
  };
  const importReplay = () => {
    try {
      run((actions) => actions.importJson())();
      setImportError(null);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const reset = () => {
    run((actions) => actions.reset())();
    setImportError(null);
  };

  const { mode } = view;
  const playback = mode === 'playback';
  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const button = (name: string, enabled: boolean, onClick: () => void) => (
    <button type="button" className={buttonClass} disabled={!ready || !enabled} onClick={onClick}>
      {name}
    </button>
  );

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Replay Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="replay-frame" data-readout="frame" /> /{' '}
          <span data-testid="replay-length" data-readout="length" />
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {button(
          'Record',
          mode !== 'recording',
          run((actions) => actions.record()),
        )}
        {button(
          'Stop',
          mode === 'recording',
          run((actions) => actions.stop()),
        )}
        {button(
          'Play',
          playback,
          run((actions) => actions.play()),
        )}
        {button(
          'Pause',
          playback,
          run((actions) => actions.pause()),
        )}
        {button(
          'Step',
          playback,
          run((actions) => actions.step()),
        )}
        {button('Reset', true, reset)}
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          Seek
          <input
            ref={seekRef}
            type="range"
            min={0}
            max={view.length}
            step={1}
            defaultValue={0}
            disabled={!playback}
            onChange={(event) => run((actions) => actions.seek(event.target.valueAsNumber))()}
            className="w-64"
          />
        </label>
      </div>
      <h2 id="replay-diagnostics" className="text-sm text-neutral-400">
        Diagnostics
      </h2>
      <dl
        aria-labelledby="replay-diagnostics"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        <dt>Mode</dt>
        <dd data-testid="replay-mode" data-readout="mode" />
        <dt>P1 x (sub-units)</dt>
        <dd data-testid="replay-p1-x" data-readout="x" />
        <dt>Desync</dt>
        <dd data-testid="replay-desync" data-readout="desync" />
      </dl>
      <div ref={hostRef} data-testid="arena" className="w-full max-w-[960px]" />
      <div className="space-y-2">
        <label htmlFor="replay-json" className="block text-sm text-neutral-400">
          Replay JSON
        </label>
        <textarea
          id="replay-json"
          ref={jsonRef}
          rows={6}
          spellCheck={false}
          className="block w-full max-w-[960px] rounded bg-neutral-900 p-2 font-mono text-xs"
        />
        <div className="flex gap-2">
          {button(
            'Export',
            playback,
            run((actions) => actions.exportJson()),
          )}
          {button('Import', mode !== 'recording', importReplay)}
        </div>
        {importError && (
          <p role="alert" className="text-sm text-red-400">
            Import failed: {importError}
          </p>
        )}
      </div>
      <p className="text-sm text-neutral-400">
        Record restarts from the fixture and records live input (Player 1: ← → or A / D; Player 2:
        numpad 4 / 6 or the first gamepad). Stop shows the last recorded frame; Play re-simulates
        the replay from its inputs and stops at a checksum that does not match.
      </p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </section>
  );
}

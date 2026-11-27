import { useEffect, useRef, useState } from 'react';
import {
  createInputCapture,
  DEFAULT_PLAYER_BINDINGS,
  type InputCapture,
} from '@mortal-doctrine/input';
import { InputBit, type FrameInputs, type InputFrame } from '@mortal-doctrine/sim-core';
import { createSimulationRunner, type SimulationRunner } from '@mortal-doctrine/simulation';

const FRAMES_SHOWN = 16;
const TAPS_KEPT = 20;
const PLAYERS = [0, 1] as const;

interface Session {
  /** Supplies the 60 Hz tick, pause / step and the per-player frame history the lab displays. */
  readonly runner: SimulationRunner;
  readonly players: readonly [InputCapture, InputCapture];
  /** Latched taps, oldest first (shown newest first). Mutated by the loop, never React state. */
  readonly taps: string[];
}

export function InputLab() {
  const rootRef = useRef<HTMLElement>(null);
  const tapsRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const tapList = tapsRef.current;
    if (!root || !tapList) return;
    const session: Session = {
      runner: createSimulationRunner(),
      players: [
        createInputCapture(DEFAULT_PLAYER_BINDINGS[0]),
        createInputCapture(DEFAULT_PLAYER_BINDINGS[1]),
      ],
      taps: [],
    };
    sessionRef.current = session;
    const { runner, players, taps } = session;
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
    let last: number | undefined;
    let shownTaps = '';
    let request = requestAnimationFrame(function loop(now) {
      runner.advance(last === undefined ? 0 : now - last, (tick) => sampleTick(session, tick));
      last = now;

      write('tick', String(runner.state.frame));
      for (const player of PLAYERS) {
        const { keys, latched, gamepad } = players[player].inspect();
        const pad = gamepad
          ? `buttons ${gamepad.buttons.join(', ') || 'none'}, stick ${gamepad.stick.map((axis) => axis.toFixed(2)).join(' / ')}`
          : 'not connected';
        write(
          `raw-${player}`,
          `keys ${keys.join(', ') || 'none'} · gamepad ${DEFAULT_PLAYER_BINDINGS[player].gamepadIndex}: ${pad}`,
        );
        write(`latched-${player}`, formatFrame(latched));
        write(
          `frames-${player}`,
          runner.state.input.history[player].slice(-FRAMES_SHOWN).map(formatFrame).join(' '),
        );
      }
      const tapText = taps.join('\n');
      if (tapText !== shownTaps) {
        shownTaps = tapText;
        tapList.replaceChildren(
          ...taps.toReversed().map((tap) => {
            const item = document.createElement('li');
            item.textContent = tap;
            return item;
          }),
        );
      }
      request = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(request);
      for (const player of players) player.dispose();
      sessionRef.current = null;
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const control = (action: (session: Session) => void) => {
    const session = sessionRef.current;
    if (!session) return;
    action(session);
    setPaused(session.runner.paused);
  };
  const togglePause = () =>
    control(({ runner }) => {
      if (runner.paused) runner.resume();
      else runner.pause();
    });
  const stepTick = () =>
    control((session) => {
      session.runner.stepOnce((tick) => sampleTick(session, tick));
    });
  const reset = () =>
    control(({ runner, taps }) => {
      runner.reset();
      taps.length = 0;
    });

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Input Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Tick <span data-testid="input-tick" data-readout="tick" />
        </span>
      </header>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className={buttonClass} disabled={!paused} onClick={stepTick}>
          Step
        </button>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
      </div>
      {PLAYERS.map((player) => (
        <section key={player} className="space-y-1">
          <h2 id={`input-p${player + 1}`} className="text-sm text-neutral-400">
            Player {player + 1}
          </h2>
          <dl
            aria-labelledby={`input-p${player + 1}`}
            className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
          >
            <dt>Raw device state</dt>
            <dd data-testid={`input-raw-p${player + 1}`} data-readout={`raw-${player}`} />
            <dt>Latched for the next tick</dt>
            <dd data-testid={`input-latched-p${player + 1}`} data-readout={`latched-${player}`} />
            <dt>Sampled frames (last {FRAMES_SHOWN} ticks, oldest → newest)</dt>
            <dd data-testid={`input-frames-p${player + 1}`} data-readout={`frames-${player}`} />
          </dl>
        </section>
      ))}
      <section aria-label="Latched taps" className="w-fit min-w-64 font-mono text-xs">
        <h2 className="mb-1 text-sm text-neutral-400">
          Latched taps: released before the tick that sampled them (newest first, last {TAPS_KEPT})
        </h2>
        <ol ref={tapsRef} data-testid="input-taps" className="space-y-0.5" />
      </section>
      <p className="text-sm text-neutral-400">
        Player 1: ← → ↑ ↓ or W A S D, buttons U I O J K L; gamepad 1. Player 2: numpad 4 6 8 5,
        buttons 1–6 on the digit row; gamepad 0 (d-pad or left stick, X Y RB / A B RT). Pause, tap a
        key, then Step to see the tap land in exactly one tick.
      </p>
    </section>
  );
}

/** Samples both players for one tick, logging presses that were already released (taps). */
function sampleTick(session: Session, tick: number): FrameInputs {
  const one = (player: 0 | 1): InputFrame => {
    const capture = session.players[player];
    const { held, latched } = capture.inspect();
    const tapped = latched & ~held;
    if (tapped) {
      session.taps.push(`tick ${tick}: P${player + 1} ${formatFrame(tapped)}`);
      if (session.taps.length > TAPS_KEPT) session.taps.shift();
    }
    return capture.sample();
  };
  return [one(0), one(1)];
}

const BITS = Object.entries(InputBit);

/** Bit names joined by `+` (opposing directions shown as recorded); `·` is neutral. */
function formatFrame(frame: InputFrame): string {
  return (
    BITS.filter(([, bit]) => frame & bit)
      .map(([name]) => name)
      .join('+') || '·'
  );
}

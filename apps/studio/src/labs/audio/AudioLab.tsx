import { useEffect, useRef, useState } from 'react';
import {
  AUDIO_BUSES,
  createAudioPlayer,
  type AudioBus,
  type AudioPlayer,
  type BusState,
} from '@mortal-doctrine/audio';
import { createToneBuffers, FIXTURE_CUES, FIXTURE_EVENTS } from '@mortal-doctrine/audio/testing';

type Fixture = (typeof FIXTURE_EVENTS)[number];

interface Session {
  readonly player: AudioPlayer;
  /** Fixture events fired so far, in firing order, each once. */
  readonly fired: Fixture[];
}

const DEFAULT_BUSES = Object.fromEntries(
  AUDIO_BUSES.map((bus) => [bus, { volume: 1, muted: false }]),
) as Record<AudioBus, BusState>;

function describeEvent(event: Fixture): string {
  const fields = Object.entries(event)
    .filter(([key]) => key !== 'type' && key !== 'frame')
    .map(([key, value]) => (key === 'player' ? `P${Number(value) + 1}` : String(value)));
  return `${[event.type, ...fields].join(' ')} @${event.frame}`;
}

/** A real `AudioContext`, the Unlock button as the gesture target, synthesized tones. */
function createSession(unlockButton: HTMLButtonElement): Session {
  const context = new AudioContext();
  return {
    player: createAudioPlayer({
      context,
      cues: FIXTURE_CUES,
      buffers: createToneBuffers(context),
      gestureTarget: unlockButton,
    }),
    fired: [],
  };
}

export function AudioLab() {
  const rootRef = useRef<HTMLElement>(null);
  const unlockRef = useRef<HTMLButtonElement>(null);
  const voicesRef = useRef<HTMLUListElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [buses, setBuses] = useState(DEFAULT_BUSES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlockButton = unlockRef.current;
    const stateReadout = rootRef.current?.querySelector<HTMLElement>('[data-readout="state"]');
    const voicesList = voicesRef.current;
    const logList = logRef.current;
    if (!unlockButton || !stateReadout || !voicesList || !logList) return;
    try {
      sessionRef.current = createSession(unlockButton);
    } catch (cause) {
      console.error(cause);
      setError(String(cause));
      return;
    }
    const fill = (list: HTMLElement, lines: string[]) => {
      const text = lines.join('\n');
      if (list.dataset.shown === text) return;
      list.dataset.shown = text;
      list.replaceChildren(
        ...lines.map((line) => {
          const item = document.createElement('li');
          item.textContent = line;
          return item;
        }),
      );
    };
    // Voices end asynchronously; the loop mirrors player diagnostics into the DOM outside React.
    let request = requestAnimationFrame(function loop() {
      const player = sessionRef.current?.player;
      if (player) {
        if (stateReadout.textContent !== player.state) stateReadout.textContent = player.state;
        fill(
          voicesList,
          player.voices.map(({ cue, bus }) => `${cue} (${bus})`),
        );
        fill(
          logList,
          player.log.map(
            ({ frame, type, cue, variation }) => `frame ${frame} · ${type} → ${cue} (${variation})`,
          ),
        );
      }
      request = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(request);
      sessionRef.current?.player.dispose();
      sessionRef.current = null;
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const fire = (event: Fixture) => {
    const session = sessionRef.current;
    if (!session) return;
    if (!session.fired.includes(event)) session.fired.push(event);
    session.player.play([event]);
  };
  const resimulate = () => {
    const session = sessionRef.current;
    session?.player.play(session.fired);
  };
  const reset = () => {
    const unlockButton = unlockRef.current;
    if (!unlockButton || !sessionRef.current) return;
    sessionRef.current.player.dispose();
    sessionRef.current = createSession(unlockButton);
    setBuses(DEFAULT_BUSES);
  };
  const updateBus = (bus: AudioBus, change: Partial<BusState>) => {
    const player = sessionRef.current?.player;
    if (!player) return;
    if (change.volume !== undefined) player.setVolume(bus, change.volume);
    if (change.muted !== undefined) player.setMuted(bus, change.muted);
    setBuses((previous) => ({ ...previous, [bus]: player.bus(bus) }));
  };

  const buttonClass = 'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700';

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Audio Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Playback <span data-testid="audio-state" data-readout="state" />
        </span>
      </header>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button ref={unlockRef} type="button" className={buttonClass}>
          Unlock
        </button>
        <button type="button" className={buttonClass} onClick={resimulate}>
          Re-simulate
        </button>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
      </div>
      <section aria-label="Fixture events" className="flex flex-wrap gap-2">
        {FIXTURE_EVENTS.map((event) => (
          <button
            key={describeEvent(event)}
            type="button"
            className={buttonClass}
            onClick={() => fire(event)}
          >
            Fire {describeEvent(event)}
          </button>
        ))}
      </section>
      <section
        aria-label="Buses"
        className="grid w-fit grid-cols-[auto_auto_auto_auto] items-center gap-x-4 gap-y-1 text-sm"
      >
        {AUDIO_BUSES.map((bus) => (
          <div key={bus} className="contents">
            <span>{bus}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              aria-label={`${bus} volume`}
              value={buses[bus].volume}
              onChange={(event) => updateBus(bus, { volume: Number(event.target.value) })}
            />
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={buses[bus].muted}
                onChange={(event) => updateBus(bus, { muted: event.target.checked })}
              />
              Mute {bus}
            </label>
            <output data-testid={`audio-bus-${bus}`} className="font-mono text-xs text-neutral-400">
              {buses[bus].muted ? 'muted' : `${Math.round(buses[bus].volume * 100)}%`}
            </output>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-8 font-mono text-xs">
        <section aria-label="Active voices" className="min-w-48">
          <h2 className="mb-1 text-sm text-neutral-400">Active voices</h2>
          <ul data-testid="audio-voices" ref={voicesRef} className="space-y-0.5" />
        </section>
        <section aria-label="Triggered cues" className="min-w-64">
          <h2 className="mb-1 text-sm text-neutral-400">Triggered cues (oldest first)</h2>
          <ol data-testid="audio-log" ref={logRef} className="space-y-0.5" />
        </section>
      </div>
      <p className="text-sm text-neutral-400">
        Playback stays locked until a pointer or key gesture on Unlock. Each fixture event plays its
        cue once: firing it again or Re-simulate re-sends it with the same identity, so nothing new
        plays. Tones are generated placeholders.
      </p>
    </section>
  );
}

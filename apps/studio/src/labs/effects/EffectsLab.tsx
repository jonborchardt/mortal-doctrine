import { useEffect, useRef, useState } from 'react';
import { createEffectsRenderable } from '@mortal-doctrine/effects';
import { CORE_EFFECTS, CORE_MAPPING, FIXTURE_EVENTS } from '@mortal-doctrine/effects/testing';
import { createArenaRenderer } from '@mortal-doctrine/renderer';
import { TICK_MS } from '@mortal-doctrine/sim-core';
import {
  createInitialState,
  step,
  type SimulationEvent,
  type SimulationState,
} from '@mortal-doctrine/simulation';

type Fixture = keyof typeof FIXTURE_EVENTS;
const FIRE: Record<Fixture, string> = {
  land: 'Fire land (P1)',
  jump: 'Fire jump (P2)',
  wallContact: 'Fire wall-contact (P2)',
  command: 'Fire command (P1)',
};
const INITIAL = createInitialState();

/** Control actions, created with the session inside the effect. */
interface Actions {
  fire(fixture: Fixture): void;
  refeed(): void;
  restore(): void;
  setPaused(paused: boolean): void;
  step(): void;
  reset(): void;
}

export function EffectsLab() {
  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    const list = listRef.current;
    if (!host || !root || !list) return;
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const renderer = await createArenaRenderer(host);
      teardown = () => renderer.destroy();
      if (disposed) return teardown();
      const effects = createEffectsRenderable({ definitions: CORE_EFFECTS, mapping: CORE_MAPPING });
      renderer.register(effects);

      let state: SimulationState;
      let lastBatch: SimulationEvent[];
      let pending: readonly SimulationEvent[];
      let paused: boolean;
      let displayMs: number;
      const load = () => {
        state = INITIAL;
        lastBatch = [];
        pending = [];
        paused = false;
        displayMs = 0;
        effects.clear();
      };
      load();
      const advance = (ms: number) => {
        displayMs += ms;
        effects.advance(ms);
      };

      actionsRef.current = {
        // One idle tick of the production simulation that "produced" the fixture event.
        fire(fixture) {
          lastBatch = [{ ...FIXTURE_EVENTS[fixture], frame: state.frame }];
          state = step(state, [0, 0]).state;
          pending = lastBatch;
        },
        // The same batch with the same snapshot again, as a re-simulated frame delivers it.
        refeed() {
          pending = lastBatch;
        },
        // Back to the frame 0 snapshot: a lower frame clears the effects.
        restore() {
          state = INITIAL;
        },
        setPaused(next) {
          paused = next;
        },
        step: () => advance(TICK_MS),
        reset: load,
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
        if (!paused) advance(elapsedMs);
        renderer.render(state, { events: pending });
        pending = [];

        const active = effects.active;
        write('frame', String(state.frame));
        write('count', String(active.length));
        write('age', active[0] ? active[0].ageMs.toFixed(1) : '-');
        write('display', displayMs.toFixed(1));
        const lines = active.map(
          ({ id, ageMs, lifetimeMs }) => `${id} ${ageMs.toFixed(1)} / ${lifetimeMs} ms`,
        );
        const text = lines.join('\n');
        if (list.dataset.shown !== text) {
          list.dataset.shown = text;
          list.replaceChildren(
            ...lines.map((line) => {
              const item = document.createElement('li');
              item.textContent = line;
              return item;
            }),
          );
        }
      });

      setReady(true);
      teardown = () => {
        unsubscribe();
        renderer.destroy();
        actionsRef.current = null;
      };
    })().catch((cause: unknown) => {
      console.error(cause);
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  // Event handlers only: refs must not be read during render.
  const act = (action: (actions: Actions) => void) => {
    const actions = actionsRef.current;
    if (actions) action(actions);
  };

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  // `key` stays stable when a label toggles (Pause/Resume) so the button keeps keyboard focus.
  const button = (
    label: string,
    onClick: (actions: Actions) => void,
    enabled = true,
    key = label,
  ) => (
    <button
      key={key}
      type="button"
      className={buttonClass}
      disabled={!ready || !enabled}
      onClick={() => act(onClick)}
    >
      {label}
    </button>
  );
  const readout = (label: string, key: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={`effects-${key}`} data-readout={key} />
    </>
  );

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Effects Lab</h1>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FIRE) as Fixture[]).map((fixture) =>
          button(FIRE[fixture], (actions) => actions.fire(fixture)),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {button('Re-feed last batch', (actions) => actions.refeed())}
        {button('Restore frame 0', (actions) => actions.restore())}
        {button(
          paused ? 'Resume' : 'Pause',
          (actions) => {
            actions.setPaused(!paused);
            setPaused(!paused);
          },
          true,
          'pause',
        )}
        {button('Step', (actions) => actions.step(), paused)}
        {button('Reset', (actions) => {
          actions.reset();
          setPaused(false);
        })}
      </div>
      <div
        ref={hostRef}
        data-testid="arena"
        role="img"
        aria-label="Placeholder fighters with effects"
        aria-describedby="effects-diagnostics"
        className="w-full max-w-[960px]"
      />
      <h2 id="effects-diagnostics" className="text-sm text-neutral-400">
        Diagnostics
      </h2>
      <dl
        aria-labelledby="effects-diagnostics"
        className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs text-neutral-400"
      >
        {readout('Snapshot frame', 'frame')}
        {readout('Active effects', 'count')}
        {readout('Oldest age (ms)', 'age')}
        {readout('Display time (ms)', 'display')}
      </dl>
      <h2 id="effects-active-heading" className="text-sm text-neutral-400">
        Active effects (id, age / lifetime)
      </h2>
      <ul
        ref={listRef}
        aria-labelledby="effects-active-heading"
        data-testid="effects-active"
        className="font-mono text-xs text-neutral-400"
      />
      <p className="text-sm text-neutral-400">
        The production effects renderable in the renderer&apos;s <code>effects</code> layer, with
        the core placeholder effects. Each Fire button runs one idle production <code>step</code>{' '}
        and feeds the fixture event of that tick. Re-feed delivers the last batch again: the same
        event identity never spawns twice. Restore draws the frame 0 snapshot: a lower frame clears
        every effect. Effects age by display time only, so Pause freezes them and Step advances one
        display step ({TICK_MS.toFixed(1)} ms).
      </p>
      {error && (
        <p role="alert" className="text-red-400">
          Effects failed: {error}
        </p>
      )}
    </section>
  );
}

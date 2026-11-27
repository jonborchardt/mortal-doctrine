import { useEffect, useRef, useState } from 'react';
import { createInputCapture, DEFAULT_PLAYER_BINDINGS } from '@mortal-doctrine/input';
import { SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
import { createSimulationRunner } from '@mortal-doctrine/simulation';

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const p1Ref = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let teardown = () => {};

    // Loaded lazily so PixiJS ships as its own chunk and the page shell paints first.
    import('@mortal-doctrine/renderer')
      .then(({ createArenaRenderer }) => createArenaRenderer(host))
      .then((renderer) => {
        if (disposed) return renderer.destroy();
        const runner = createSimulationRunner();
        const p1 = createInputCapture(DEFAULT_PLAYER_BINDINGS[0]);
        const p2 = createInputCapture(DEFAULT_PLAYER_BINDINGS[1]);

        // The per-frame loop lives outside React: HUD text is written directly, never via state.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          // Sampled once per simulation tick, so taps shorter than a tick are not lost.
          runner.advance(elapsedMs, () => [p1.sample(), p2.sample()]);
          renderer.render(runner.state);
          setText(frameRef.current, String(runner.state.frame));
          setText(fpsRef.current, String(Math.round(renderer.fps)));
          setText(p1Ref.current, String(runner.state.fighters[0].x / SUBUNITS_PER_UNIT));
        });

        teardown = () => {
          unsubscribe();
          p1.dispose();
          p2.dispose();
          renderer.destroy();
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

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-3xl font-bold tracking-widest uppercase">Mortal Doctrine</h1>
      <div className="flex gap-6 font-mono text-sm text-neutral-400">
        <span>
          Frame <span data-testid="sim-frame" ref={frameRef} />
        </span>
        <span>
          FPS <span data-testid="render-fps" ref={fpsRef} />
        </span>
        <span>
          P1 x <span data-testid="p1-x" ref={p1Ref} />
        </span>
      </div>
      <div ref={hostRef} data-testid="arena" className="w-full max-w-[960px]" />
      <p className="text-sm text-neutral-400">
        Player 1: ← → or A / D · Player 2: numpad 4 / 6 or the first gamepad
      </p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </main>
  );
}

function setText(element: HTMLElement | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

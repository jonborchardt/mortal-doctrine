import { useEffect, useRef, useState } from 'react';
import { createKeyboardInput } from '@mortal-doctrine/input';
import { NEUTRAL_INPUT, SUBUNITS_PER_UNIT } from '@mortal-doctrine/sim-core';
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
        const keyboard = createKeyboardInput(window);

        // The per-frame loop lives outside React: HUD text is written directly, never via state.
        const unsubscribe = renderer.onFrame((elapsedMs) => {
          // Sampled once per simulation tick; player two is idle until a second device exists.
          runner.advance(elapsedMs, () => [keyboard.read(), NEUTRAL_INPUT]);
          renderer.render(runner.state);
          setText(frameRef.current, String(runner.state.frame));
          setText(fpsRef.current, String(Math.round(renderer.fps)));
          setText(p1Ref.current, String(runner.state.fighters[0].x / SUBUNITS_PER_UNIT));
        });

        teardown = () => {
          unsubscribe();
          keyboard.dispose();
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
      <p className="text-sm text-neutral-500">Move with ← → or A / D</p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </main>
  );
}

function setText(element: HTMLElement | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

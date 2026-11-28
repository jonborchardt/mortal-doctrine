import { useEffect, useRef, useState } from 'react';

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const p1Ref = useRef<HTMLSpanElement>(null);
  const effectsRef = useRef<HTMLSpanElement>(null);
  const cuesRef = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let teardown = () => {};
    const fail = (cause: unknown) => {
      console.error(cause);
      if (!disposed) setError(String(cause));
    };

    // Loaded lazily so PixiJS ships as its own chunk and the page shell paints first. The
    // per-frame loop lives in `match.ts`, outside React: HUD text is written directly.
    import('./match')
      .then(({ startMatch }) => {
        if (disposed) return;
        teardown = startMatch(
          host,
          {
            frame: frameRef.current,
            fps: fpsRef.current,
            p1x: p1Ref.current,
            effects: effectsRef.current,
            cues: cuesRef.current,
          },
          fail,
        );
      })
      .catch(fail);

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
        <span>
          Effects <span data-testid="effects-spawned" ref={effectsRef} />
        </span>
        <span>
          Cues <span data-testid="audio-cues" ref={cuesRef} />
        </span>
      </div>
      <div
        ref={hostRef}
        data-testid="arena"
        role="img"
        aria-label="Two mannequin fighters in the placeholder arena"
        className="w-full max-w-[960px]"
      />
      <p className="text-sm text-neutral-400">
        Player 1: A / D or ← → to walk, W or ↑ to jump, S or ↓ to crouch · Player 2: numpad 4 / 6 /
        8 / 5 or the first gamepad · Sound plays after the first key or pointer press
      </p>
      {error && <p className="text-red-400">Renderer failed: {error}</p>}
    </main>
  );
}

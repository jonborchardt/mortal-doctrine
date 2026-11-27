import { useEffect, useRef, useState } from 'react';
import {
  createArenaRenderer,
  loadTextureManifest,
  type ArenaRenderer,
} from '@mortal-doctrine/renderer';
import type { Pose, Rig } from '@mortal-doctrine/rig';
import { createInitialState } from '@mortal-doctrine/simulation';
import {
  createSkeletonRenderable,
  type Facing,
  type SkeletonRenderable,
} from '@mortal-doctrine/skeleton-renderer';

const MANIFEST = '/fixtures/skeleton/manifest.json';
// Same framing as the SVG debug view (260 × 210 world units, ground line 15 above the bottom
// edge), at 2 px per world unit.
const WIDTH = 520;
const HEIGHT = 420;
const VIEW = { scale: 2, originX: 260, originY: 390 } as const;
const CHARACTER_ORIGIN = { x: 0, y: 0 } as const;
// The renderer's frame carries a simulation snapshot; nothing here reads it.
const STATE = createInitialState();

/** The production skeletal renderable drawing `rig` at `pose`, in its own Pixi canvas. */
export function SkeletonCanvas({
  rig,
  pose,
  facing,
}: {
  readonly rig: Rig;
  readonly pose: Pose;
  readonly facing: Facing;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<ArenaRenderer>();
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ pose, facing });
  const renderableRef = useRef<SkeletonRenderable>(undefined);
  // Tail of the texture loads so far: the manifest's URLs have one owner at a time, so a load
  // starts only after the previous one finished and (if its rig was dropped) was released.
  const loads = useRef<Promise<void>>(Promise.resolve());

  // React only hands over inputs on change; drawing happens in the renderer's frame callback.
  useEffect(() => {
    latest.current = { pose, facing };
    renderableRef.current?.setPose(pose, facing, CHARACTER_ORIGIN);
  }, [pose, facing]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let created: ArenaRenderer | undefined;
    createArenaRenderer(host, { width: WIDTH, height: HEIGHT, placeholders: false }).then(
      (next) => {
        if (disposed) return next.destroy();
        created = next;
        next.setView(VIEW);
        next.onFrame(() => next.render(STATE));
        setRenderer(next);
      },
      (cause: unknown) => {
        console.error(cause);
        setError(String(cause));
      },
    );
    return () => {
      disposed = true;
      created?.destroy();
    };
  }, []);

  // A rig needs its own renderable: unregister the old one (which releases its textures), then
  // load again and register the new one.
  useEffect(() => {
    if (!renderer) return;
    let cancelled = false;
    let unregister = () => {};
    loads.current = loads.current
      .then(async () => {
        if (cancelled) return;
        const textures = await loadTextureManifest(MANIFEST);
        const renderable = createSkeletonRenderable({ rig, layer: 'fighters', textures });
        if (cancelled) return renderable.destroy();
        renderable.setPose(latest.current.pose, latest.current.facing, CHARACTER_ORIGIN);
        renderableRef.current = renderable;
        unregister = renderer.register(renderable);
        setError(null);
      })
      .catch((cause: unknown) => {
        console.error(cause);
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      renderableRef.current = undefined;
      unregister();
    };
  }, [renderer, rig]);

  return (
    <div className="w-[36rem] max-w-full">
      <div
        ref={hostRef}
        role="img"
        aria-label={`${rig.id} rig rendered view`}
        data-testid="arena"
        className="overflow-hidden rounded border border-neutral-800"
      />
      {error !== null && (
        <p role="alert" className="mt-1 text-sm text-red-400">
          Skeleton rendering failed: {error}
        </p>
      )}
    </div>
  );
}

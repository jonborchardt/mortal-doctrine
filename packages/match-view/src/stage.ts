import { createArenaRenderable, type Arena } from '@mortal-doctrine/arena';
import {
  createEffectsRenderable,
  type EffectsRenderable,
  type EffectsRenderableOptions,
} from '@mortal-doctrine/effects';
import {
  createArenaRenderer,
  loadTextureManifest,
  type ArenaRenderer,
  type LoadedTextures,
} from '@mortal-doctrine/renderer';
import type { Rig } from '@mortal-doctrine/rig';
import { createSkeletonRenderable } from '@mortal-doctrine/skeleton-renderer';
import type { DrawFrame } from './presenter';

export interface MatchStageOptions {
  /** Canvas size in logical pixels. */
  readonly viewport: { readonly width: number; readonly height: number };
  readonly arena: Arena;
  /** URL of the texture manifest for `arena`. */
  readonly arenaManifest: string;
  /** Both fighters are drawn with this rig. */
  readonly rig: Rig;
  /** URL of the texture manifest for `rig`. */
  readonly skeletonManifest: string;
  readonly effects: EffectsRenderableOptions;
}

export interface MatchStage {
  /** For `onFrame` and frame diagnostics. The mount owns it: do not destroy it. */
  readonly renderer: ArenaRenderer;
  readonly effects: EffectsRenderable;
  /** Sets the view and both fighters' poses, then renders the snapshot with its events. */
  readonly draw: (frame: DrawFrame) => void;
}

export interface MatchStageMount {
  /** The stage once built; `undefined` when disposed first. Rejects when loading fails. */
  readonly ready: Promise<MatchStage | undefined>;
  /** Destroys the renderer and everything registered on it. Idempotent. */
  dispose(): void;
}

// Tail of the mounts so far. A texture manifest's URLs have one owner at a time, so a stage
// starts only after the previous one was built or abandoned and the textures it loaded were
// released (React StrictMode mounts twice).
let mounts: Promise<unknown> = Promise.resolve();

/**
 * Builds the match canvas in `host`: a renderer without placeholders, the arena, two skeletons
 * and the effects. Mounts are queued; one disposed while waiting or loading builds nothing more.
 */
export function mountMatchStage(host: HTMLElement, options: MatchStageOptions): MatchStageMount {
  const { viewport, arena, rig } = options;
  let disposed = false;
  let renderer: ArenaRenderer | undefined;
  // Releases started so far: the renderables start them on destroy and do not wait.
  const releases: Promise<void>[] = [];
  const load = async (manifestUrl: string): Promise<LoadedTextures> => {
    const textures = await loadTextureManifest(manifestUrl);
    return {
      ...textures,
      release() {
        const done = textures.release();
        releases.push(done.catch(() => undefined));
        return done;
      },
    };
  };

  const build = async (): Promise<MatchStage | undefined> => {
    if (disposed) return undefined;
    const created = await createArenaRenderer(host, { ...viewport, placeholders: false });
    if (disposed) {
      created.destroy();
      return undefined;
    }
    renderer = created;

    // On a renderer destroyed meanwhile, `register` destroys the renderable, which releases the
    // textures it owns.
    created.register(
      createArenaRenderable({
        arena,
        textures: await load(options.arenaManifest),
        viewportWidth: viewport.width,
      }),
    );
    if (disposed) return undefined;
    // One manifest has one owner, and both skeletons draw from it: the second renderable owns
    // the textures, the first borrows them and is destroyed first (ticket #222).
    const textures = await load(options.skeletonManifest);
    const borrowed = { ...textures, release: () => Promise.resolve() };
    const skeletons = [borrowed, textures].map((owned) => {
      const skeleton = createSkeletonRenderable({ rig, layer: 'fighters', textures: owned });
      created.register(skeleton);
      return skeleton;
    });
    if (disposed) return undefined;
    const effects = createEffectsRenderable(options.effects);
    created.register(effects);

    return {
      renderer: created,
      effects,
      draw({ state, events, view, poses }) {
        created.setView(view);
        state.fighters.forEach((fighter, index) =>
          skeletons[index]?.setPose(poses[index] ?? {}, fighter.facing, fighter),
        );
        created.render(state, { events });
      },
    };
  };

  const ready = mounts.then(build);
  const settled = () => Promise.all(releases);
  mounts = ready.catch(() => undefined).then(settled);
  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer?.destroy();
      mounts = mounts.then(settled);
    },
  };
}

import { Assets, type Texture } from 'pixi.js';
import { parseTextureManifest } from './manifest';

export interface LoadedTextures {
  /** Texture id → texture; sizes are logical pixels (pixel size ÷ resolution). */
  readonly textures: Readonly<Record<string, Texture>>;
  /** Texture id → absolute URL it was loaded from (the Pixi asset cache key). */
  readonly urls: Readonly<Record<string, string>>;
  /** Unloads every texture from Pixi's asset cache and destroys it. Idempotent. */
  release(): Promise<void>;
}

// A URL being released must finish unloading before it is loaded again, or the new load would
// receive the texture that is about to be destroyed.
const releasing = new Map<string, Promise<void>>();

async function unload(url: string): Promise<void> {
  const done = Assets.unload(url).finally(() => {
    // Drop the resolver entry so the next load honours its own `resolution`.
    Assets.resolver.removeAlias(url);
    releasing.delete(url);
  });
  releasing.set(url, done);
  return done;
}

/**
 * Fetches a texture manifest and loads every texture it lists at `resolution` (default 2: a
 * 192×64 px file is 96×32 logical px). Rejects naming the texture id and URL that failed, after
 * releasing whatever had loaded.
 */
export async function loadTextureManifest(
  manifestUrl: string,
  { resolution = 2 }: { resolution?: number } = {},
): Promise<LoadedTextures> {
  const absolute = new URL(manifestUrl, document.baseURI).href;
  const response = await fetch(absolute);
  if (!response.ok) {
    throw new Error(`Asset manifest ${absolute}: HTTP ${response.status}`);
  }
  const urls = parseTextureManifest(await response.json(), absolute);
  const entries = Object.entries(urls);

  const loaded = await Promise.allSettled(
    entries.map(async ([id, url]) => {
      await releasing.get(url);
      try {
        return await Assets.load<Texture>({ alias: url, src: url, data: { resolution } });
      } catch (cause) {
        // Nothing was cached; forget the alias so a retry honours its own resolution.
        Assets.resolver.removeAlias(url);
        throw new Error(`Texture "${id}" failed to load from ${url}: ${String(cause)}`, { cause });
      }
    }),
  );
  const textures: Record<string, Texture> = {};
  let failure: Error | undefined;
  loaded.forEach((result, index) => {
    const [id = ''] = entries[index] ?? [];
    if (result.status === 'fulfilled') textures[id] = result.value;
    else
      failure ??= result.reason instanceof Error ? result.reason : new Error(String(result.reason));
  });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all(Object.keys(textures).map((id) => unload(urls[id] ?? '')));
  };
  if (failure !== undefined) {
    await release();
    throw failure;
  }
  return { textures, urls, release };
}

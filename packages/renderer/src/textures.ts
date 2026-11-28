import { Assets, type Texture } from 'pixi.js';
import { parseTextureManifest } from './manifest';

export interface LoadedTextures {
  /** Texture id → texture; sizes are logical pixels (pixel size ÷ resolution). */
  readonly textures: Readonly<Record<string, Texture>>;
  /** Texture id → absolute URL it was loaded from (the Pixi asset cache key). */
  readonly urls: Readonly<Record<string, string>>;
  /**
   * Gives this handle's textures back. A texture is unloaded from Pixi's asset cache and
   * destroyed when the last handle holding its URL is released. Idempotent.
   */
  release(): Promise<void>;
}

// Pixi caches one texture per URL with no reference count, so the handles holding a URL are
// counted here and the URL is unloaded when the last one lets go.
interface Held {
  readonly resolution: number;
  readonly texture: Promise<Texture>;
  count: number;
}
const held = new Map<string, Held>();

// A URL being unloaded must finish before it is loaded again, or the new load would receive the
// texture that is about to be destroyed.
const releasing = new Map<string, Promise<void>>();

/** Takes one count on `url`, loading it when nothing holds it. */
async function acquire(url: string, resolution: number): Promise<Texture> {
  while (releasing.has(url)) await releasing.get(url);
  // No await from here to the count: a release racing this load sees it.
  let entry = held.get(url);
  if (entry === undefined) {
    entry = {
      resolution,
      count: 0,
      texture: Assets.load<Texture>({ alias: url, src: url, data: { resolution } }),
    };
    held.set(url, entry);
  } else if (entry.resolution !== resolution) {
    throw new Error(
      `${url} is loaded at resolution ${entry.resolution} and cannot also be loaded at ${resolution}`,
    );
  }
  entry.count += 1;
  try {
    return await entry.texture;
  } catch (cause) {
    if (held.get(url) === entry) {
      // Nothing was cached; forget the alias so a retry honours its own resolution.
      held.delete(url);
      Assets.resolver.removeAlias(url);
    }
    throw cause;
  }
}

/** Gives one count on `url` back; the last one unloads it. */
function drop(url: string): Promise<void> {
  const entry = held.get(url);
  if (entry === undefined) return Promise.resolve();
  entry.count -= 1;
  if (entry.count > 0) return Promise.resolve();
  held.delete(url);
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
 * 192×64 px file is 96×32 logical px). Every call returns its own handle; handles on the same URL
 * share one texture, so a URL some live handle holds at another resolution is rejected. Rejects
 * naming the texture id and URL that failed, after releasing whatever it had acquired.
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

  const loaded = await Promise.all(
    entries.map(async ([id, url]) => {
      try {
        return { url, id, texture: await acquire(url, resolution) };
      } catch (cause) {
        const error = new Error(`Texture "${id}" failed to load from ${url}: ${String(cause)}`, {
          cause,
        });
        return { url, id, error };
      }
    }),
  );
  const textures: Record<string, Texture> = {};
  const loadedUrls: string[] = [];
  let failure: Error | undefined;
  for (const result of loaded) {
    if ('texture' in result) {
      textures[result.id] = result.texture;
      loadedUrls.push(result.url);
    } else {
      failure ??= result.error;
    }
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all(loadedUrls.map(drop));
  };
  if (failure !== undefined) {
    await release();
    throw failure;
  }
  return { textures, urls, release };
}

import { Assets } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { loadTextureManifest } from '../src/index';

const BASE = 'http://assets.test/';
const BODY = `${BASE}rig/body.png`;
const HEAD = `${BASE}rig/head.png`;

let load: MockInstance;
let unload: MockInstance;
/** URLs whose next loads reject. */
let broken: Set<string>;
/** Every handle a test obtained, released afterwards so no count leaks into the next test. */
let handles: { release(): Promise<void> }[];

async function open(manifest = 'rig/manifest.json', resolution?: number) {
  const handle = await loadTextureManifest(
    manifest,
    resolution === undefined ? {} : { resolution },
  );
  handles.push(handle);
  return handle;
}

const unloadsOf = (url: string) => unload.mock.calls.filter(([asset]) => asset === url).length;
const loadsOf = (url: string) =>
  load.mock.calls.filter(([asset]) => (asset as { src: string }).src === url).length;

beforeEach(() => {
  broken = new Set();
  handles = [];
  const manifests: Record<string, Record<string, string>> = {
    [`${BASE}rig/manifest.json`]: { body: 'body.png', head: 'head.png' },
    [`${BASE}rig/body-only.json`]: { body: 'body.png' },
  };
  vi.stubGlobal('document', { baseURI: BASE });
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ schemaVersion: 1, textures: manifests[url] }),
    }),
  );
  load = vi.spyOn(Assets, 'load').mockImplementation((asset: unknown) => {
    const { src, data } = asset as { src: string; data: { resolution: number } };
    return broken.has(src)
      ? Promise.reject(new Error('decode failed'))
      : Promise.resolve({ src, resolution: data.resolution, destroyed: false } as never);
  });
  unload = vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
  vi.spyOn(Assets.resolver, 'removeAlias').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(handles.map((handle) => handle.release()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('texture handles sharing a URL', () => {
  it.each([
    ['sequential loads, first released first', false, false],
    ['sequential loads, second released first', false, true],
    ['concurrent loads, first released first', true, false],
    ['concurrent loads, second released first', true, true],
  ])('%s: unloads once, with the last release', async (_name, concurrent, reversed) => {
    const pair = concurrent ? await Promise.all([open(), open()]) : [await open(), await open()];
    const [first, second] = reversed ? [pair[1], pair[0]] : pair;
    if (first === undefined || second === undefined) throw new Error('two handles expected');

    expect(first).not.toBe(second);
    expect(first.textures.body).toBe(second.textures.body);
    expect(first.textures.head).toBe(second.textures.head);
    expect(loadsOf(BODY)).toBe(1);
    expect(loadsOf(HEAD)).toBe(1);

    await first.release();
    expect(unload).not.toHaveBeenCalled();
    await first.release();
    expect(unload).not.toHaveBeenCalled();

    await second.release();
    expect(unloadsOf(BODY)).toBe(1);
    expect(unloadsOf(HEAD)).toBe(1);
    await second.release();
    await first.release();
    expect(unload).toHaveBeenCalledTimes(2);
  });

  it('a load still fetching its manifest when the last handle is released loads afresh', async () => {
    const first = await open();
    const pending = open();
    await first.release();
    const second = await pending;
    // It held no texture yet, so the release unloaded; it then got a new texture, not that one.
    expect(unloadsOf(BODY)).toBe(1);
    expect(loadsOf(BODY)).toBe(2);
    expect(second.textures.body).not.toBe(first.textures.body);
    await second.release();
    expect(unloadsOf(BODY)).toBe(2);
  });

  it('loads again after the last release, at the resolution then asked for', async () => {
    const first = await open();
    await first.release();
    const second = await open('rig/manifest.json', 1);
    expect(loadsOf(BODY)).toBe(2);
    expect(second.textures.body).not.toBe(first.textures.body);
    expect(second.textures.body).toMatchObject({ resolution: 1 });
    await second.release();
    expect(unloadsOf(BODY)).toBe(2);
  });

  it('waits for the pending unload before loading a URL again', async () => {
    let finishUnload = () => {};
    unload.mockImplementationOnce(
      () => new Promise<void>((resolve) => void (finishUnload = resolve)),
    );
    const first = await open('rig/body-only.json');
    const released = first.release();
    const pending = open('rig/body-only.json');
    await vi.waitFor(() => expect(unloadsOf(BODY)).toBe(1));
    await Promise.resolve();
    expect(loadsOf(BODY)).toBe(1);
    finishUnload();
    await released;
    await pending;
    expect(loadsOf(BODY)).toBe(2);
  });

  it('rejects a live URL asked for at another resolution and leaves its handle usable', async () => {
    const live = await open('rig/body-only.json', 2);
    const error = await open('rig/manifest.json', 1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toContain('Texture "body"');
    expect(message).toContain(BODY);
    expect(message).toContain('resolution 2');
    // The head it had acquired alone is given back; the body another handle holds is not.
    expect(unloadsOf(HEAD)).toBe(1);
    expect(unloadsOf(BODY)).toBe(0);
    expect(live.textures.body?.destroyed).toBe(false);

    await live.release();
    await live.release();
    expect(unloadsOf(BODY)).toBe(1);
  });

  it('a failed texture rejects with its id and URL without unloading a URL still held', async () => {
    const live = await open('rig/body-only.json');
    broken.add(HEAD);
    await expect(open()).rejects.toThrow(`Texture "head" failed to load from ${HEAD}`);
    expect(unload).not.toHaveBeenCalled();

    await live.release();
    expect(unloadsOf(BODY)).toBe(1);
    expect(unloadsOf(HEAD)).toBe(0);
  });

  it('a failed texture with no other holder unloads what did load exactly once', async () => {
    broken.add(HEAD);
    await expect(open()).rejects.toThrow(`Texture "head" failed to load from ${HEAD}`);
    expect(unloadsOf(BODY)).toBe(1);
    expect(unloadsOf(HEAD)).toBe(0);

    // The failure left no count behind: the next load is a fresh one and unloads on release.
    broken.clear();
    const retry = await open();
    expect(loadsOf(HEAD)).toBe(2);
    await retry.release();
    expect(unloadsOf(BODY)).toBe(2);
    expect(unloadsOf(HEAD)).toBe(1);
  });
});

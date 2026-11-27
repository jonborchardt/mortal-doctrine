import { Assets, Sprite } from 'pixi.js';
import { loadTextureManifest, worldToScreen, type Renderable } from '@mortal-doctrine/renderer';

// Lab-local renderable proving the renderer's extension API: a manifest-loaded solid block
// centred on player one's start position, mid-body, wider than the fighter.
export const FIXTURE_MANIFEST = '/fixtures/renderer/manifest.json';
export const FIXTURE_TEXTURE = 'fixture-block';
const CENTRE = { x: 24000, y: 7000 } as const;

/** What the lab shows about each fixture it created; mutated by the fixture, never React state. */
export interface FixtureRecord {
  readonly id: number;
  readonly layer: string;
  updates: number;
  lastFrame: number;
  destroys: number;
  /** Undefined until destroyed; then whether its textures left Pixi's asset cache. */
  released: boolean | undefined;
}

export interface Fixture {
  readonly renderable: Renderable;
  readonly record: FixtureRecord;
  /** Logical size of the loaded texture, e.g. `96×32`. */
  readonly size: string;
}

let nextId = 1;
/** Every fixture ever registered in this page, oldest first, so teardown stays observable. */
export const fixtureRecords: FixtureRecord[] = [];

export function formatFixtureRecord(record: FixtureRecord): string {
  const textures =
    record.released === undefined ? 'loaded' : record.released ? 'released' : 'NOT released';
  return `#${record.id} ${record.layer}: updates ${record.updates}, last frame ${record.lastFrame}, destroyed ${record.destroys}, textures ${textures}`;
}

export async function createFixture(layer: string, resolution: number): Promise<Fixture> {
  const loaded = await loadTextureManifest(FIXTURE_MANIFEST, { resolution });
  const texture = loaded.textures[FIXTURE_TEXTURE];
  if (!texture) {
    await loaded.release();
    throw new Error(`Fixture manifest has no texture "${FIXTURE_TEXTURE}"`);
  }
  const sprite = new Sprite({ texture, anchor: 0.5 });
  const record: FixtureRecord = {
    id: nextId++,
    layer,
    updates: 0,
    lastFrame: -1,
    destroys: 0,
    released: undefined,
  };
  const renderable: Renderable = {
    layer,
    container: sprite,
    update({ state, view }) {
      record.updates++;
      record.lastFrame = state.frame;
      const centre = worldToScreen(view, CENTRE.x, CENTRE.y);
      sprite.position.set(centre.x, centre.y);
      sprite.scale.set(view.scale);
    },
    destroy() {
      record.destroys++;
      sprite.destroy();
      void loaded.release().then(
        () => (record.released = Object.values(loaded.urls).every((url) => !Assets.cache.has(url))),
        () => (record.released = false),
      );
    },
  };
  return { renderable, record, size: `${texture.width}×${texture.height}` };
}

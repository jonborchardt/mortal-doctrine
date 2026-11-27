import { describe, expect, it } from 'vitest';
import {
  createAudioPlayer,
  DEDUPE_WINDOW_FRAMES,
  loadSoundManifest,
  parseCueRegistry,
  parseSoundManifest,
  type CueDefinition,
} from '../src/index';
import {
  createFakeAudioContext,
  createToneBuffers,
  FakeGestureTarget,
  FIXTURE_CUES,
  FIXTURE_EVENTS,
} from '../src/testing';

function setup(cues: readonly CueDefinition[] = FIXTURE_CUES) {
  const context = createFakeAudioContext();
  const gestureTarget = new FakeGestureTarget();
  const player = createAudioPlayer({
    context,
    cues,
    buffers: createToneBuffers(context),
    gestureTarget,
  });
  const unlock = () => gestureTarget.dispatchEvent(new Event('pointerdown'));
  return { context, gestureTarget, player, unlock };
}

const land = (frame: number, player = 0) => ({ type: 'land', frame, player });

const started = (context: ReturnType<typeof createFakeAudioContext>) =>
  context.sources.filter((source) => source.started > 0).length;

describe('dedupe', () => {
  it('starts each fixture event cue exactly once, across repeats and re-simulated ranges', () => {
    const { context, player, unlock } = setup();
    unlock();
    player.play(FIXTURE_EVENTS);
    expect(started(context)).toBe(FIXTURE_EVENTS.length);
    expect(context.sources.every((source) => source.started === 1)).toBe(true);
    expect(player.log.map(({ frame, type, cue }) => [frame, type, cue])).toEqual([
      [4, 'command', 'command'],
      [4, 'command', 'command'],
      [12, 'command', 'command'],
      [20, 'jump', 'jump'],
      [52, 'land', 'land'],
      [70, 'wall-contact', 'wall'],
    ]);

    player.play(FIXTURE_EVENTS);
    // Re-simulated range overlapping played frames (restore to frame 12, run on).
    player.play(FIXTURE_EVENTS.filter((event) => event.frame >= 12));
    player.play(FIXTURE_EVENTS.slice(2, 4));
    expect(context.sources).toHaveLength(FIXTURE_EVENTS.length);
  });

  it('plays a new event after re-simulation and tells identical same-frame events apart', () => {
    const { context, player, unlock } = setup();
    unlock();
    player.play([land(5), land(5)]);
    expect(context.sources).toHaveLength(2);
    player.play([land(5), land(5)]);
    expect(context.sources).toHaveLength(2);
    player.play([land(5), land(5, 1)]);
    expect(context.sources).toHaveLength(3);
  });

  it('tells events apart by nested fields', () => {
    const { context, player, unlock } = setup();
    unlock();
    const nested = (x: number) => ({ type: 'land', frame: 5, at: { x } });
    player.play([nested(1)]);
    player.play([nested(2)]);
    expect(context.sources).toHaveLength(2);
  });

  it('starts nothing for unconfigured event types', () => {
    const { context, player, unlock } = setup();
    unlock();
    player.play([{ type: 'round-start', frame: 1 }]);
    expect(context.sources).toHaveLength(0);
    expect(player.log).toEqual([]);
  });

  it('forgets keys older than the dedupe window', () => {
    const { context, player, unlock } = setup();
    unlock();
    const old = land(0);
    player.play([old]);
    player.play([land(DEDUPE_WINDOW_FRAMES)]);
    player.play([old]);
    expect(context.sources).toHaveLength(2);
    player.play([land(DEDUPE_WINDOW_FRAMES + 1)]);
    player.play([old]);
    expect(context.sources).toHaveLength(4);
  });

  it('tracks active voices until their source ends and caps the log', () => {
    const { context, player, unlock } = setup();
    unlock();
    player.play(FIXTURE_EVENTS.slice(3, 5));
    expect(player.voices).toEqual([
      { cue: 'jump', bus: 'voice' },
      { cue: 'land', bus: 'sfx' },
    ]);
    context.sources[0]!.end();
    expect(player.voices).toEqual([{ cue: 'land', bus: 'sfx' }]);
    expect(context.sources[0]!.listeners.size).toBe(0);
    player.play(Array.from({ length: 100 }, (_, frame) => land(frame, 1)));
    expect(player.log).toHaveLength(64);
    expect(player.log.at(-1)?.frame).toBe(99);
  });
});

describe('variations', () => {
  it('picks the same variation for the same identity and spreads different identities', () => {
    const pick = () => {
      const { player, unlock } = setup();
      unlock();
      player.play(FIXTURE_EVENTS);
      return player.log.filter((entry) => entry.cue === 'command').map((e) => e.variation);
    };
    const first = pick();
    expect(pick()).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);

    // The same identity in a different batch still picks the same variation.
    const { player, unlock } = setup();
    unlock();
    player.play([FIXTURE_EVENTS[2]!]);
    expect(player.log[0]?.variation).toBe(first[2]);
  });
});

describe('buses', () => {
  it('applies volume and mute synchronously to one bus only', () => {
    const { context, player } = setup();
    const [sfx, voice, music] = context.gains.map((node) => node.gain);
    expect(context.gains.every((node) => node.connections[0] === context.destination)).toBe(true);
    player.setVolume('sfx', 0.4);
    expect(sfx?.value).toBe(0.4);
    player.setMuted('sfx', true);
    expect(sfx?.value).toBe(0);
    expect(player.bus('sfx')).toEqual({ volume: 0.4, muted: true });
    player.setVolume('sfx', 0.6);
    expect(sfx?.value).toBe(0);
    player.setMuted('sfx', false);
    expect(sfx?.value).toBe(0.6);
    expect([voice?.value, music?.value]).toEqual([1, 1]);
    player.setVolume('music', 2);
    expect(music?.value).toBe(1);
  });

  it('routes each cue to its bus gain', () => {
    const { context, player, unlock } = setup();
    unlock();
    player.play(FIXTURE_EVENTS.slice(3));
    expect(
      context.sources.map((source) => context.gains.indexOf(source.connections[0] as never)),
    ).toEqual([1, 0, 2]);
  });
});

describe('unlock', () => {
  it('stays locked and silent until a gesture, then resumes once and plays', () => {
    const { context, gestureTarget, player, unlock } = setup();
    expect(player.state).toBe('locked');
    expect(gestureTarget.listenerCount).toBe(2);
    player.play(FIXTURE_EVENTS);
    expect(context.resumeCalls).toBe(0);
    expect(context.sources).toHaveLength(0);

    gestureTarget.dispatchEvent(new Event('keydown'));
    unlock();
    expect(player.state).toBe('unlocked');
    expect(context.resumeCalls).toBe(1);
    expect(gestureTarget.listenerCount).toBe(0);
    // Locked-period events were dropped, not remembered: they play now.
    player.play(FIXTURE_EVENTS);
    expect(started(context)).toBe(FIXTURE_EVENTS.length);
  });
});

describe('dispose', () => {
  it('stops voices, removes listeners, closes the context and is idempotent', () => {
    const { context, gestureTarget, player, unlock } = setup();
    unlock();
    player.play(FIXTURE_EVENTS);
    const lockedTarget = new FakeGestureTarget();
    const lockedContext = createFakeAudioContext();
    const lockedPlayer = createAudioPlayer({
      context: lockedContext,
      cues: FIXTURE_CUES,
      buffers: createToneBuffers(lockedContext),
      gestureTarget: lockedTarget,
    });

    player.dispose();
    lockedPlayer.dispose();
    expect(context.closeCalls).toBe(1);
    expect(lockedContext.closeCalls).toBe(1);
    expect(lockedTarget.listenerCount).toBe(0);
    expect(gestureTarget.listenerCount).toBe(0);
    expect(context.sources.every((source) => source.stopped === 1)).toBe(true);
    expect(context.sources.every((source) => source.listeners.size === 0)).toBe(true);
    expect(player.voices).toEqual([]);
    expect(player.state).toBe('disposed');

    player.dispose();
    expect(context.closeCalls).toBe(1);
    player.play([land(999)]);
    expect(context.sources).toHaveLength(FIXTURE_EVENTS.length);
  });
});

describe('cue registry and sound manifest', () => {
  const MANIFEST_URL = 'https://example.test/audio/manifest.json';

  it('parses valid cues and rejects duplicates and unknown buses naming the field', () => {
    expect(parseCueRegistry(FIXTURE_CUES)).toEqual(FIXTURE_CUES);
    expect(() => parseCueRegistry([...FIXTURE_CUES, FIXTURE_CUES[1]])).toThrow(
      /4\.id: duplicate cue id "jump"/,
    );
    expect(() => parseCueRegistry([{ ...FIXTURE_CUES[0], bus: 'ambience' }])).toThrow(/0\.bus/);
  });

  it('rejects a player whose cue names a sound with no buffer', () => {
    const cues = [{ id: 'hit', bus: 'sfx', variations: ['missing'], events: ['land'] }] as const;
    expect(() => setup(cues as unknown as CueDefinition[])).toThrow(
      'Cue "hit" names sound "missing", which has no buffer',
    );
  });

  it('parses manifests and rejects bad versions and paths', () => {
    expect(
      parseSoundManifest({ schemaVersion: 1, sounds: { hit: 'sfx/hit.ogg' } }, MANIFEST_URL),
    ).toEqual({ hit: 'https://example.test/audio/sfx/hit.ogg' });
    expect(() => parseSoundManifest({ schemaVersion: 2, sounds: {} }, MANIFEST_URL)).toThrow(
      /schemaVersion: Invalid input: expected 1/,
    );
    expect(() =>
      parseSoundManifest({ schemaVersion: 1, sounds: { hit: '/hit.ogg' } }, MANIFEST_URL),
    ).toThrow(/sounds\.hit: must be relative/);
    expect(() =>
      parseSoundManifest({ schemaVersion: 1, sounds: { hit: '../hit.ogg' } }, MANIFEST_URL),
    ).toThrow(/sounds\.hit: must not contain "\.\."/);
  });

  const files: Record<string, unknown> = {
    'https://example.test/audio/sfx/hit.ogg': new ArrayBuffer(3),
    'https://example.test/audio/bad.ogg': new ArrayBuffer(0),
  };
  const fetched: string[] = [];
  const fakeFetch = ((input: string) => {
    fetched.push(input);
    const body = files[input];
    if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(body instanceof ArrayBuffer ? new Response(body) : Response.json(body));
  }) as unknown as typeof fetch;

  it('loads buffers keyed by sound id from URLs resolved against the manifest', async () => {
    files[MANIFEST_URL] = { schemaVersion: 1, sounds: { hit: 'sfx/hit.ogg' } };
    const context = createFakeAudioContext();
    const buffers = await loadSoundManifest(MANIFEST_URL, { fetch: fakeFetch, context });
    expect(Object.keys(buffers)).toEqual(['hit']);
    expect(context.decoded).toEqual([3]);
    expect(fetched).toContain('https://example.test/audio/sfx/hit.ogg');
  });

  it('rejects a failed fetch or decode naming the sound id and URL', async () => {
    const context = createFakeAudioContext();
    files[MANIFEST_URL] = { schemaVersion: 1, sounds: { bad: 'bad.ogg' } };
    await expect(loadSoundManifest(MANIFEST_URL, { fetch: fakeFetch, context })).rejects.toThrow(
      'Failed to load sound "bad" from https://example.test/audio/bad.ogg: Unable to decode',
    );
    files[MANIFEST_URL] = { schemaVersion: 1, sounds: { gone: 'gone.ogg' } };
    await expect(loadSoundManifest(MANIFEST_URL, { fetch: fakeFetch, context })).rejects.toThrow(
      'Failed to load sound "gone" from https://example.test/audio/gone.ogg: HTTP 404',
    );
  });
});

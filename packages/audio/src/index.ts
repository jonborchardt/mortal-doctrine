import type { SimulationEventEnvelope } from '@mortal-doctrine/sim-core';
import { z } from 'zod';

export const AUDIO_BUSES = ['sfx', 'voice', 'music'] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

/**
 * Played-event keys whose frame is more than this many frames before the newest frame seen are
 * forgotten (10 s at 60 Hz). A rewind further back than this plays its cues again.
 */
export const DEDUPE_WINDOW_FRAMES = 600;
/** The triggered-cue log keeps this many entries, oldest dropped first. */
const TRIGGERED_LOG_LIMIT = 64;

// ---------------------------------------------------------------------------------------------
// Web Audio surface the player uses. A real `AudioContext` satisfies it; tests pass a fake.

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface AudioGainLike {
  readonly gain: { value: number };
  connect(destination: unknown): unknown;
}
export interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  connect(destination: unknown): unknown;
  start(): void;
  stop(): void;
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
}
export interface AudioContextLike {
  readonly destination: unknown;
  readonly sampleRate: number;
  createGain(): AudioGainLike;
  createBufferSource(): AudioSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Cue registry

const cueSchema = z.strictObject({
  id: z.string().min(1),
  bus: z.enum(AUDIO_BUSES),
  /** Sound ids; one is picked per event, deterministically from its identity. */
  variations: z.array(z.string().min(1)).min(1),
  /** Event `type`s that trigger this cue. */
  events: z.array(z.string().min(1)).min(1),
});
export type CueDefinition = z.infer<typeof cueSchema>;

const cueRegistrySchema = z.array(cueSchema).superRefine((cues, ctx) => {
  const seen = new Set<string>();
  cues.forEach((cue, index) => {
    if (seen.has(cue.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate cue id "${cue.id}"`,
      });
    }
    seen.add(cue.id);
  });
});

/** Validates cue definitions. Throws naming the offending field (e.g. `1.bus`, `2.id`). */
export function parseCueRegistry(json: unknown): CueDefinition[] {
  const result = cueRegistrySchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid cue registry: ${describeIssues(result.error)}`);
  return result.data;
}

// ---------------------------------------------------------------------------------------------
// Sound manifest

// Same path rules as the texture manifest (`@mortal-doctrine/renderer`).
const soundPath = z
  .string()
  .min(1)
  .refine((path) => !path.includes('\\'), 'must use forward slashes')
  .refine(
    (path) => !path.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(path),
    'must be relative to the manifest',
  )
  // URL resolution treats `%2e` as `.`, so percent-encoded dot segments are parents too.
  .refine(
    (path) => !path.split('/').some((segment) => /^(?:\.|%2e){2}$/i.test(segment)),
    'must not contain ".."',
  );

const soundManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sounds: z.record(z.string().min(1), soundPath),
});

/**
 * Validates a `schemaVersion: 1` sound manifest `{ schemaVersion, sounds: { id: path } }` and
 * resolves each path against the absolute `manifestUrl`. Returns sound id → absolute URL.
 */
export function parseSoundManifest(json: unknown, manifestUrl: string): Record<string, string> {
  const result = soundManifestSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid sound manifest ${manifestUrl}: ${describeIssues(result.error)}`);
  }
  return Object.fromEntries(
    Object.entries(result.data.sounds).map(([id, path]) => [id, new URL(path, manifestUrl).href]),
  );
}

/**
 * Fetches the manifest at `manifestUrl`, then fetches and decodes every sound. Resolves to
 * buffers keyed by sound id; rejects naming the sound id and URL of the first failure.
 */
export async function loadSoundManifest(
  manifestUrl: string,
  options: { readonly fetch: typeof fetch; readonly context: AudioContextLike },
): Promise<Record<string, AudioBufferLike>> {
  const response = await options.fetch(manifestUrl);
  if (!response.ok)
    throw new Error(`Failed to fetch sound manifest ${manifestUrl}: HTTP ${response.status}`);
  const urls = parseSoundManifest(await response.json(), manifestUrl);
  const entries = await Promise.all(
    Object.entries(urls).map(async ([id, url]) => {
      try {
        const file = await options.fetch(url);
        if (!file.ok) throw new Error(`HTTP ${file.status}`);
        return [id, await options.context.decodeAudioData(await file.arrayBuffer())] as const;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load sound "${id}" from ${url}: ${reason}`, { cause: error });
      }
    }),
  );
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------------------------
// Player

export type AudioPlayerState = 'locked' | 'unlocked' | 'disposed';
export interface ActiveVoice {
  readonly cue: string;
  readonly bus: AudioBus;
}
export interface TriggeredCue {
  readonly frame: number;
  readonly type: string;
  readonly cue: string;
  /** The sound id picked from the cue's variations. */
  readonly variation: string;
}
export interface BusState {
  readonly volume: number;
  readonly muted: boolean;
}

export interface AudioPlayerOptions {
  /** Owned by the player from now on: `dispose()` closes it. */
  readonly context: AudioContextLike;
  readonly cues: readonly CueDefinition[];
  /** Decoded sounds keyed by sound id; every cue variation must have one. */
  readonly buffers: Readonly<Record<string, AudioBufferLike>>;
  /** The first `pointerdown` or `keydown` here unlocks playback. */
  readonly gestureTarget: EventTarget;
}

export interface AudioPlayer {
  readonly state: AudioPlayerState;
  /**
   * Triggers the cue of every event not played before (see README: event identity). Events
   * arriving while locked or after dispose are dropped and not remembered.
   */
  play(events: readonly SimulationEventEnvelope<string>[]): void;
  setVolume(bus: AudioBus, volume: number): void;
  setMuted(bus: AudioBus, muted: boolean): void;
  bus(bus: AudioBus): BusState;
  /** Voices still playing, oldest first. */
  readonly voices: readonly ActiveVoice[];
  /** Triggered cues, oldest first, at most `TRIGGERED_LOG_LIMIT`. */
  readonly log: readonly TriggeredCue[];
  /** Stops voices, removes listeners and closes the context. Idempotent. */
  dispose(): void;
}

const GESTURES = ['pointerdown', 'keydown'] as const;

interface Voice extends ActiveVoice {
  readonly source: AudioSourceLike;
  readonly onEnded: () => void;
}

export function createAudioPlayer(options: AudioPlayerOptions): AudioPlayer {
  const { context, buffers, gestureTarget } = options;
  const cues = parseCueRegistry(options.cues);
  for (const cue of cues) {
    for (const sound of cue.variations) {
      if (!buffers[sound])
        throw new Error(`Cue "${cue.id}" names sound "${sound}", which has no buffer`);
    }
  }
  const cuesByType = new Map<string, CueDefinition[]>();
  for (const cue of cues) {
    for (const type of cue.events) cuesByType.set(type, [...(cuesByType.get(type) ?? []), cue]);
  }

  const buses = Object.fromEntries(
    AUDIO_BUSES.map((bus) => {
      const gain = context.createGain();
      gain.connect(context.destination);
      return [bus, { gain, volume: 1, muted: false }];
    }),
  ) as Record<AudioBus, { gain: AudioGainLike; volume: number; muted: boolean }>;
  const applyGain = (bus: AudioBus) => {
    const entry = buses[bus];
    entry.gain.gain.value = entry.muted ? 0 : entry.volume;
  };

  let state: AudioPlayerState = 'locked';
  const played = new Map<string, number>(); // identity key → frame
  let newestFrame = -Infinity;
  let voices: Voice[] = [];
  const log: TriggeredCue[] = [];

  const unlock = () => {
    removeGestureListeners();
    state = 'unlocked';
    // Resume only fails on a closed context, which dispose() already handles.
    context.resume().catch(() => undefined);
  };
  const removeGestureListeners = () => {
    for (const type of GESTURES) gestureTarget.removeEventListener(type, unlock);
  };
  for (const type of GESTURES) gestureTarget.addEventListener(type, unlock);

  const start = (cue: CueDefinition, variation: string) => {
    const source = context.createBufferSource();
    source.buffer = buffers[variation] ?? null;
    source.connect(buses[cue.bus].gain);
    const onEnded = () => {
      source.removeEventListener('ended', onEnded);
      voices = voices.filter((voice) => voice.source !== source);
    };
    source.addEventListener('ended', onEnded);
    voices = [...voices, { cue: cue.id, bus: cue.bus, source, onEnded }];
    source.start();
  };

  return {
    get state() {
      return state;
    },
    play(events) {
      if (state !== 'unlocked') return;
      const occurrences = new Map<string, number>();
      for (const event of events) {
        const fields = event as unknown as Readonly<Record<string, unknown>>;
        const base = JSON.stringify(
          Object.keys(fields)
            .sort()
            .map((field) => [field, fields[field]]),
        );
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        const key = `${base}#${occurrence}`;
        if (played.has(key)) continue;
        played.set(key, event.frame);
        if (event.frame > newestFrame) {
          newestFrame = event.frame;
          // ponytail: linear prune per new newest frame; fine for a few hundred keys.
          for (const [old, frame] of played) {
            if (frame < newestFrame - DEDUPE_WINDOW_FRAMES) played.delete(old);
          }
        }
        for (const cue of cuesByType.get(event.type) ?? []) {
          const variation = cue.variations[hash(`${cue.id}|${key}`) % cue.variations.length]!;
          start(cue, variation);
          log.push({ frame: event.frame, type: event.type, cue: cue.id, variation });
        }
      }
      if (log.length > TRIGGERED_LOG_LIMIT) log.splice(0, log.length - TRIGGERED_LOG_LIMIT);
    },
    setVolume(bus, volume) {
      buses[bus].volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
      applyGain(bus);
    },
    setMuted(bus, muted) {
      buses[bus].muted = muted;
      applyGain(bus);
    },
    bus(bus) {
      return { volume: buses[bus].volume, muted: buses[bus].muted };
    },
    get voices() {
      return voices.map(({ cue, bus }) => ({ cue, bus }));
    },
    get log() {
      return [...log];
    },
    dispose() {
      if (state === 'disposed') return;
      state = 'disposed';
      removeGestureListeners();
      for (const { source, onEnded } of voices) {
        source.removeEventListener('ended', onEnded);
        source.stop();
      }
      voices = [];
      context.close().catch(() => undefined);
    },
  };
}

/** FNV-1a, 32-bit, with the murmur3 finalizer so the low bits mix well for `%`. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

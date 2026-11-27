import type { SimulationEventEnvelope } from '@mortal-doctrine/sim-core';
import type { AudioBufferLike, AudioContextLike, AudioSourceLike, CueDefinition } from './index';

export interface FakeGain {
  readonly gain: { value: number };
  readonly connections: unknown[];
  connect(destination: unknown): unknown;
}
export interface FakeSource extends AudioSourceLike {
  readonly connections: unknown[];
  started: number;
  stopped: number;
  /** `ended` listeners currently attached. */
  readonly listeners: Set<() => void>;
  /** Simulates the sound finishing: calls the `ended` listeners. */
  end(): void;
}
export interface FakeAudioContext extends AudioContextLike {
  readonly gains: FakeGain[];
  readonly sources: FakeSource[];
  resumeCalls: number;
  closeCalls: number;
  /** Byte lengths passed to `decodeAudioData`. It rejects empty data. */
  readonly decoded: number[];
}

/** A recording stand-in for `AudioContext`; nothing is audible. */
export function createFakeAudioContext(): FakeAudioContext {
  const sampleRate = 8000;
  const context: FakeAudioContext = {
    destination: { kind: 'destination' },
    sampleRate,
    gains: [],
    sources: [],
    resumeCalls: 0,
    closeCalls: 0,
    decoded: [],
    createGain() {
      const connections: unknown[] = [];
      const gain: FakeGain = {
        gain: { value: 1 },
        connections,
        connect: (destination) => connections.push(destination),
      };
      context.gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const connections: unknown[] = [];
      const listeners = new Set<() => void>();
      const source: FakeSource = {
        buffer: null,
        connections,
        started: 0,
        stopped: 0,
        listeners,
        connect: (destination) => connections.push(destination),
        start: () => void (source.started += 1),
        stop: () => void (source.stopped += 1),
        addEventListener: (_type, listener) => void listeners.add(listener),
        removeEventListener: (_type, listener) => void listeners.delete(listener),
        end: () => [...listeners].forEach((listener) => listener()),
      };
      context.sources.push(source);
      return source;
    },
    createBuffer: (channels, length) => fakeBuffer(channels, length),
    decodeAudioData(data) {
      context.decoded.push(data.byteLength);
      if (data.byteLength === 0) return Promise.reject(new Error('Unable to decode audio data'));
      return Promise.resolve(fakeBuffer(1, data.byteLength));
    },
    resume() {
      context.resumeCalls += 1;
      return Promise.resolve();
    },
    close() {
      context.closeCalls += 1;
      return Promise.resolve();
    },
  };
  return context;
}

function fakeBuffer(channels: number, length: number): AudioBufferLike {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    getChannelData: (channel) => {
      const samples = data[channel];
      if (!samples) throw new RangeError(`No channel ${channel}`);
      return samples;
    },
  };
}

/** An `EventTarget` that counts its attached listeners. */
export class FakeGestureTarget extends EventTarget {
  readonly #attached = new Map<string, Set<unknown>>();

  get listenerCount(): number {
    return [...this.#attached.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }

  override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.#attached.set(args[0], (this.#attached.get(args[0]) ?? new Set()).add(args[1]));
    super.addEventListener(...args);
  }

  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.#attached.get(args[0])?.delete(args[1]);
    super.removeEventListener(...args);
  }
}

/** Sound id → placeholder tone (frequency Hz, duration ms). */
const FIXTURE_TONES: Readonly<Record<string, { frequency: number; durationMs: number }>> = {
  'command-low': { frequency: 330, durationMs: 120 },
  'command-mid': { frequency: 440, durationMs: 120 },
  'command-high': { frequency: 554, durationMs: 120 },
  'jump-voice': { frequency: 660, durationMs: 180 },
  'land-thud': { frequency: 110, durationMs: 160 },
  'wall-sting': { frequency: 220, durationMs: 400 },
};

/** Every bus, a multi-variation cue, and one cue per current `SimulationEvent` type. */
export const FIXTURE_CUES: readonly CueDefinition[] = [
  {
    id: 'command',
    bus: 'sfx',
    variations: ['command-low', 'command-mid', 'command-high'],
    events: ['command'],
  },
  { id: 'jump', bus: 'voice', variations: ['jump-voice'], events: ['jump'] },
  { id: 'land', bus: 'sfx', variations: ['land-thud'], events: ['land'] },
  { id: 'wall', bus: 'music', variations: ['wall-sting'], events: ['wall-contact'] },
];

type FixtureEvent = SimulationEventEnvelope<string> & Readonly<Record<string, unknown>>;

/** One event of each current `SimulationEvent` shape, three `command` identities. */
export const FIXTURE_EVENTS: readonly FixtureEvent[] = [
  { type: 'command', frame: 4, player: 0, command: 'quarter-circle' },
  { type: 'command', frame: 4, player: 1, command: 'quarter-circle' },
  { type: 'command', frame: 12, player: 0, command: 'dragon-punch' },
  { type: 'jump', frame: 20, player: 0 },
  { type: 'land', frame: 52, player: 0 },
  { type: 'wall-contact', frame: 70, player: 1, side: 'right' },
];

/** Synthesizes the fixture sounds as decaying sine tones in memory, keyed by sound id. */
export function createToneBuffers(context: AudioContextLike): Record<string, AudioBufferLike> {
  const rate = context.sampleRate;
  return Object.fromEntries(
    Object.entries(FIXTURE_TONES).map(([id, { frequency, durationMs }]) => {
      const length = Math.max(1, Math.round((rate * durationMs) / 1000));
      const buffer = context.createBuffer(1, length, rate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        samples[i] = 0.3 * Math.sin((2 * Math.PI * frequency * i) / rate) * (1 - i / length);
      }
      return [id, buffer];
    }),
  );
}

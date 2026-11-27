import type { FrameInputs } from '@mortal-doctrine/sim-core';
import { serializeState, type SimulationState } from '@mortal-doctrine/simulation';

// FNV-1a, 32 bit. For desync detection only: not an integrity or security hash.
const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

// XOR then multiply by an odd constant is a bijection on 32-bit words, so two digests that
// differ stay different however many equal values are mixed in afterwards.
const mix = (hash: number, value: number) => Math.imul(hash ^ value, PRIME);

/** Fixed-width form of a digest: 8 lowercase hex digits. */
export const formatHash = (hash: number) => (hash >>> 0).toString(16).padStart(8, '0');

/** Deterministic hash of `serializeState(state)`: 8 lowercase hex digits. */
export function hashState(state: SimulationState): string {
  const text = serializeState(state);
  let hash = OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) hash = mix(hash, text.charCodeAt(i));
  return formatHash(hash);
}

/** Digest of an empty input stream. */
export const EMPTY_INPUTS_DIGEST = OFFSET_BASIS;

/** Running digest of the input stream: the digest of `inputs[0..n)` extended by tick `n`. */
export const digestInputs = (digest: number, inputs: FrameInputs) =>
  mix(mix(digest, inputs[0]), inputs[1]);

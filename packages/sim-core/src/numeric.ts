import { z } from 'zod';

/** Integer sub-units per world unit (1 world unit = 1 logical pixel at the default viewport). */
export const SUBUNITS_PER_UNIT = 100;

export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;

/** Every number stored in simulation state uses this schema (or a narrower one). */
export const int32Schema = z.int32();

/** Throws unless `value` is an integer in the signed 32-bit range. */
export function assertInt32(value: number, name = 'value'): void {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new RangeError(`${name} must be an int32 in [${INT32_MIN}, ${INT32_MAX}], got ${value}`);
  }
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

/**
 * Integer division truncating toward zero, so `divTrunc(-a, b) === -divTrunc(a, b)`.
 * Exact for every safe integer: `a % b` is exact, so `a - a % b` is an exact multiple of `b`.
 */
export function divTrunc(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  if (denominator === 0) throw new RangeError('denominator must not be 0');
  // `+ 0` normalizes -0 to 0 so results compare equal under Object.is.
  return (numerator - (numerator % denominator)) / denominator + 0;
}

/**
 * `value * numerator / denominator`, truncated toward zero. Throws instead of returning an
 * inexact value when the product leaves the safe-integer range.
 */
export function scaleRatio(value: number, numerator: number, denominator: number): number {
  assertSafeInteger(value, 'value');
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  const product = value * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(
      `scaleRatio intermediate ${value} * ${numerator} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  return divTrunc(product, denominator);
}

/** Moves `velocity` toward zero by `amount` (>= 0) and clamps at zero: never overshoots. */
export function decelerate(velocity: number, amount: number): number {
  assertSafeInteger(velocity, 'velocity');
  assertSafeInteger(amount, 'amount');
  if (amount < 0) throw new RangeError(`amount must be >= 0, got ${amount}`);
  if (velocity > 0) return Math.max(0, velocity - amount);
  if (velocity < 0) return Math.min(0, velocity + amount);
  return 0;
}

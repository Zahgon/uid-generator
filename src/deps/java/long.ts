/*
 * Reimplementation shim: Java `long` arithmetic.
 *
 * Every id this component emits is a Java `long`: a signed 64-bit two's
 * complement integer whose shifts take their distance modulo 64 and whose
 * arithmetic wraps silently on overflow. JavaScript's `number` cannot hold one,
 * so `bigint` carries the value and the helpers below re-impose the width.
 */

/** Number of bits in a Java `long`. */
export const LONG_BITS = 64;

/** `Long.MIN_VALUE`. */
export const LONG_MIN_VALUE = -(2n ** 63n);

/** `Long.MAX_VALUE`. */
export const LONG_MAX_VALUE = 2n ** 63n - 1n;

/** Truncate an arbitrary bigint to the signed 64-bit range, wrapping. */
export function toLong(value: bigint): bigint {
  return BigInt.asIntN(LONG_BITS, value);
}

/** Reinterpret a Java `long` as an unsigned 64-bit value. */
export function toUnsignedLong(value: bigint): bigint {
  return BigInt.asUintN(LONG_BITS, value);
}

/**
 * Java's `<<` on a `long`. The shift distance is masked to its low 6 bits, so
 * `x << 64` is `x`, not `0`.
 */
export function shiftLeft(value: bigint, distance: number): bigint {
  return toLong(value << BigInt(distance & 63));
}

/** Java's arithmetic `>>` on a `long`: sign-propagating, distance mod 64. */
export function shiftRight(value: bigint, distance: number): bigint {
  return toLong(value >> BigInt(distance & 63));
}

/** Java's logical `>>>` on a `long`: zero-filling, distance mod 64. */
export function unsignedShiftRight(value: bigint, distance: number): bigint {
  return toLong(toUnsignedLong(value) >> BigInt(distance & 63));
}

/** Java's `~` on a `long`. */
export function not(value: bigint): bigint {
  return toLong(~value);
}

/** Java's `|` on two `long`s. */
export function or(left: bigint, right: bigint): bigint {
  return toLong(left | right);
}

/** Java's `&` on two `long`s. */
export function and(left: bigint, right: bigint): bigint {
  return toLong(left & right);
}

/** Java's `+` on two `long`s, wrapping on overflow. */
export function add(left: bigint, right: bigint): bigint {
  return toLong(left + right);
}

/** Java's `-` on two `long`s, wrapping on overflow. */
export function subtract(left: bigint, right: bigint): bigint {
  return toLong(left - right);
}

/** `Integer.bitCount`, over the low 32 bits of a non-negative count. */
export function bitCount(value: number): number {
  let bits = value | 0;
  let count = 0;
  while (bits !== 0) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
}

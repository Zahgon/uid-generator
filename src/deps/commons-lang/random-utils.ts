/*
 * Reimplementation shim: `org.apache.commons.lang.math.RandomUtils.nextInt(int)`.
 *
 * commons-lang delegates to `java.util.Random.nextInt(n)`, which is uniform
 * over `[0, n)` and throws when `n` is not positive. The generator itself is
 * not part of the contract — only the range and the exception are — so this
 * uses the platform CSPRNG with rejection sampling rather than reproducing
 * java.util.Random's linear congruential stream.
 */

import { randomInt } from 'node:crypto';

/** `RandomUtils.nextInt(int n)` — uniform in `[0, n)`. */
export function nextInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('n must be positive');
  }
  return randomInt(n);
}

export const RandomUtils = { nextInt } as const;

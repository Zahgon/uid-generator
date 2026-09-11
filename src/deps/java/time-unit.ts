/*
 * Reimplementation shim: the two `java.util.concurrent.TimeUnit` conversions
 * the component uses. Both are integer divisions/multiplications on `long`s,
 * so they truncate toward zero rather than rounding.
 */

import { toLong } from './long.js';

export const TimeUnit = {
  MILLISECONDS: {
    /** `TimeUnit.MILLISECONDS.toSeconds(d)` — integer division by 1000. */
    toSeconds(duration: bigint): bigint {
      return toLong(duration / 1000n);
    },
  },
  SECONDS: {
    /** `TimeUnit.SECONDS.toMillis(d)` — multiplication by 1000. */
    toMillis(duration: bigint): bigint {
      return toLong(duration * 1000n);
    },
  },
} as const;

/*
 * Tests for `BitsAllocator` — the 64-bit layout every id in this component is
 * built from.
 */

import { describe, expect, test } from 'vitest';
import { BitsAllocator } from '../src/bits-allocator.js';
import { IllegalArgumentException } from '../src/deps/spring/assert.js';

describe('BitsAllocator', () => {
  test('TOTAL_BITS is 1 << 6', () => {
    expect(BitsAllocator.TOTAL_BITS).toBe(64);
  });

  test('the default allocation exposes the documented maxima and shifts', () => {
    const allocator = new BitsAllocator(28, 22, 13);
    expect(allocator.getSignBits()).toBe(1);
    expect(allocator.getTimestampBits()).toBe(28);
    expect(allocator.getWorkerIdBits()).toBe(22);
    expect(allocator.getSequenceBits()).toBe(13);
    expect(allocator.getMaxDeltaSeconds()).toBe(268435455n);
    expect(allocator.getMaxWorkerId()).toBe(4194303n);
    expect(allocator.getMaxSequence()).toBe(8191n);
    expect(allocator.getTimestampShift()).toBe(35);
    expect(allocator.getWorkerIdShift()).toBe(13);
  });

  test('the bits must add up to 64 including the sign bit', () => {
    expect(() => new BitsAllocator(28, 22, 12)).toThrow(IllegalArgumentException);
    expect(() => new BitsAllocator(28, 22, 12)).toThrow('allocate not enough 64 bits');
    expect(() => new BitsAllocator(29, 21, 13)).not.toThrow();
  });

  test('allocate lays the three fields out in sign|delta|worker|sequence order', () => {
    const allocator = new BitsAllocator(29, 21, 13);
    // The value the JVM baseline emitted for delta 314518889, worker 1, seq 3380.
    expect(allocator.allocate(314518889n, 1n, 3380n)).toBe(5403393368917028148n);
    expect(allocator.allocate(0n, 0n, 0n)).toBe(0n);
    expect(allocator.allocate(0n, 1n, 0n)).toBe(8192n);
    expect(allocator.allocate(1n, 0n, 0n)).toBe(17179869184n);
    expect(allocator.allocate(0n, 0n, 1n)).toBe(1n);
    // Every field at its maximum fills all 63 payload bits and the sign bit.
    expect(allocator.allocate(4294967295n, 4194303n, 8191n)).toBe(-1n);
  });

  test('an expired epoch overflows into the sign bit rather than raising', () => {
    // 28 timestamp bits from epoch 2016-05-20 ran out on 2024-11-20 21:24:16.
    // At second 1788848525 the delta is 325174925, which needs 29 bits.
    const allocator = new BitsAllocator(28, 22, 13);
    expect(allocator.getMaxDeltaSeconds()).toBeLessThan(325174925n);
    expect(allocator.allocate(325174925n, 2n, 0n)).toBe(-7273818726875512832n);
    expect(allocator.allocate(325174925n, 2n, 1n)).toBe(-7273818726875512831n);
  });

  test('toString renders SHORT_PREFIX_STYLE in field declaration order', () => {
    expect(new BitsAllocator(28, 22, 13).toString()).toBe(
      'BitsAllocator[signBits=1,timestampBits=28,workerIdBits=22,sequenceBits=13,'
      + 'maxDeltaSeconds=268435455,maxWorkerId=4194303,maxSequence=8191,'
      + 'timestampShift=35,workerIdShift=13]',
    );
  });
});

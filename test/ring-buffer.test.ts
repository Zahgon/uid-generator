/*
 * Tests for `RingBuffer` and `BufferPaddingExecutor`.
 *
 * The upstream suite exercises the ring only indirectly, through
 * `CachedUidGeneratorTest`, and never reaches either rejection policy. These
 * drive the buffer directly.
 */

import { describe, expect, test } from 'vitest';
import { RingBuffer } from '../src/buffer/ring-buffer.js';
import { BufferPaddingExecutor } from '../src/buffer/buffer-padding-executor.js';
import type { BufferedUidProvider } from '../src/buffer/buffered-uid-provider.js';
import { IllegalArgumentException } from '../src/deps/spring/assert.js';
import { Level, setRootLevel } from '../src/deps/slf4j/logger.js';

/** Keep the ring's own INFO chatter out of the report; logback would print it. */
/**
 * Keep the ring's own INFO chatter out of the test report. logback would print
 * it; the appender is not what these tests are about.
 */
function quietlySync<T>(body: () => T): T {
  setRootLevel(Level.ERROR);
  try {
    return body();
  } finally {
    setRootLevel(Level.DEBUG);
  }
}

/** A provider handing out `size` consecutive ids per second, like the real one. */
function sequentialProvider(size: number): BufferedUidProvider {
  return (momentInSecond) => {
    const uids: bigint[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      uids.push(momentInSecond * 1000n + BigInt(offset));
    }
    return uids;
  };
}

describe('RingBuffer', () => {
  test('rejects a size that is not a positive power of two', () => {
    expect(() => new RingBuffer(0)).toThrow('RingBuffer size must be positive');
    expect(() => new RingBuffer(-8)).toThrow('RingBuffer size must be positive');
    expect(() => new RingBuffer(3)).toThrow('RingBuffer size must be a power of 2');
    // The upstream message for a bad padding factor is copy-pasted; keep it.
    expect(() => new RingBuffer(8, 0)).toThrow('RingBuffer size must be positive');
    expect(() => new RingBuffer(8, 100)).toThrow(IllegalArgumentException);
    expect(() => new RingBuffer(8, 99)).not.toThrow();
  });

  test('starts empty with both sequences at the start point', () => {
    const ring = new RingBuffer(8);
    expect(ring.getBufferSize()).toBe(8);
    expect(ring.getTail()).toBe(-1n);
    expect(ring.getCursor()).toBe(-1n);
    expect(ring.toString())
      .toBe('RingBuffer [bufferSize=8, tail=-1, cursor=-1, paddingThreshold=4]');
  });

  test('put publishes the tail and take advances the cursor', () => {
    const ring = new RingBuffer(8);
    expect(ring.put(100n)).toBe(true);
    expect(ring.getTail()).toBe(0n);
    expect(ring.getCursor()).toBe(-1n);
    expect(ring.take()).toBe(100n);
    expect(ring.getCursor()).toBe(0n);
  });

  test('holds bufferSize ids and then applies the put rejection policy', () => {
    // `tail` starts at -1, so the full condition `tail - cursor == size - 1` is
    // only met after `size` puts: a fresh 8-slot ring accepts 0..7 and rejects
    // the ninth. The JVM baseline shows the same, filling a 65536-slot ring to
    // tail=65535 on its first padding pass.
    const ring = new RingBuffer(8);
    const rejected: bigint[] = [];
    ring.setRejectedPutHandler((_ringBuffer, uid) => rejected.push(uid));
    for (let i = 0; i < 8; i += 1) {
      expect(ring.put(BigInt(i))).toBe(true);
    }
    expect(ring.put(8n)).toBe(false);
    expect(rejected).toEqual([8n]);
    expect(ring.getTail()).toBe(7n);
  });

  test('the default put policy discards and only logs', () => {
    const ring = new RingBuffer(8);
    quietlySync(() => {
      for (let i = 0; i < 8; i += 1) {
        ring.put(BigInt(i));
      }
      expect(ring.put(8n)).toBe(false);
    });
    expect(ring.getTail()).toBe(7n);
  });

  test('a take does not immediately free a slot: the distance is measured from the cursor', () => {
    // Pins the `tail - cursor == bufferSize - 1` guard on its own, independently
    // of the CAN_PUT flag check that also stands between a put and a full ring.
    // These are the JVM's own answers, taken from a probe against the original:
    // 8 puts fill it, one take is not enough to admit another put, two are.
    const ring = new RingBuffer(8);
    const rejected: bigint[] = [];
    ring.setRejectedPutHandler((_ringBuffer, uid) => rejected.push(uid));
    for (let i = 0; i < 8; i += 1) {
      expect(ring.put(BigInt(i))).toBe(true);
    }
    expect(ring.getTail()).toBe(7n);

    expect(ring.take()).toBe(0n);
    expect(ring.getCursor()).toBe(0n);
    expect(ring.put(100n)).toBe(false);
    expect(ring.getTail()).toBe(7n);

    expect(ring.take()).toBe(1n);
    expect(ring.getCursor()).toBe(1n);
    expect(ring.put(101n)).toBe(true);
    expect(ring.getTail()).toBe(8n);
    expect(ring.put(102n)).toBe(false);
    expect(ring.getTail()).toBe(8n);

    expect(rejected).toEqual([100n, 102n]);
    expect(ring.toString())
      .toBe('RingBuffer [bufferSize=8, tail=8, cursor=1, paddingThreshold=4]');
  });

  test('an empty ring applies the take rejection policy', () => {
    const ring = new RingBuffer(8);
    let rejections = 0;
    ring.setRejectedTakeHandler(() => {
      rejections += 1;
      throw new Error('nothing to take');
    });
    expect(() => ring.take()).toThrow('nothing to take');
    expect(rejections).toBe(1);
  });

  test('the default take policy throws with the buffer state in the message', () => {
    const ring = new RingBuffer(8);
    quietlySync(() => {
      expect(() => ring.take()).toThrow(
        'Rejected take buffer. RingBuffer [bufferSize=8, tail=-1, cursor=-1, paddingThreshold=4]',
      );
    });
  });

  test('slots are reused as the sequences wrap past the buffer size', () => {
    const ring = new RingBuffer(8);
    const taken: bigint[] = [];
    for (let round = 0; round < 4; round += 1) {
      for (let i = 0; i < 6; i += 1) {
        expect(ring.put(BigInt(round * 6 + i))).toBe(true);
      }
      for (let i = 0; i < 6; i += 1) {
        taken.push(ring.take());
      }
    }
    expect(taken).toEqual(Array.from({ length: 24 }, (_unused, i) => BigInt(i)));
    expect(ring.getTail()).toBe(23n);
    expect(ring.getCursor()).toBe(23n);
  });

  test('a take below the padding threshold triggers a padding pass', () => {
    const ring = new RingBuffer(8, 50);
    const seconds: bigint[] = [];
    const executor = new BufferPaddingExecutor(ring, (second) => {
      seconds.push(second);
      return sequentialProvider(4)(second);
    }, false);
    ring.setBufferPaddingExecutor(executor);

    quietlySync(() => {
      executor.paddingBuffer();
      expect(ring.getTail()).toBe(7n);
      // Draining past the threshold (tail - cursor < 4) refills the ring.
      for (let i = 0; i < 5; i += 1) {
        ring.take();
      }
    });
    expect(seconds.length).toBeGreaterThan(1);
    expect(ring.getTail() - ring.getCursor()).toBeGreaterThanOrEqual(4n);
  });
});

describe('BufferPaddingExecutor', () => {
  test('fills the ring to capacity and reports the running flag', () => {
    const ring = new RingBuffer(8);
    const executor = new BufferPaddingExecutor(ring, sequentialProvider(4), false);
    expect(executor.isRunning()).toBe(false);
    quietlySync(() => {
      executor.paddingBuffer();
    });
    expect(executor.isRunning()).toBe(false);
    expect(ring.getTail()).toBe(7n);
  });

  test('borrows the next second on every pass', () => {
    const ring = new RingBuffer(8);
    const seconds: bigint[] = [];
    const executor = new BufferPaddingExecutor(ring, (second) => {
      seconds.push(second);
      return sequentialProvider(2)(second);
    }, false);
    quietlySync(() => {
      executor.paddingBuffer();
    });
    // Eight slots fill from four 2-id batches; the fifth batch is what finds
    // the ring full and ends the pass.
    expect(seconds).toHaveLength(5);
    expect(seconds[1]).toBe(seconds[0]! + 1n);
    expect(seconds[4]).toBe(seconds[0]! + 4n);
  });

  test('a re-entrant pass is suppressed by the single-flight guard', () => {
    const ring = new RingBuffer(8);
    let reentered = 0;
    const executor: BufferPaddingExecutor = new BufferPaddingExecutor(ring, (second) => {
      if (reentered === 0) {
        reentered += 1;
        // The guard makes this a no-op, exactly as it does on the JVM when a
        // second pool thread arrives while a pass is in flight.
        executor.paddingBuffer();
      }
      return sequentialProvider(4)(second);
    }, false);
    quietlySync(() => {
      executor.paddingBuffer();
    });
    expect(reentered).toBe(1);
    expect(ring.getTail()).toBe(7n);
  });

  test('setScheduleInterval rejects a non-positive interval', () => {
    const executor = new BufferPaddingExecutor(new RingBuffer(8), sequentialProvider(4), false);
    expect(() => { executor.setScheduleInterval(0); }).toThrow('Schedule interval must positive!');
    expect(() => { executor.setScheduleInterval(60); }).not.toThrow();
  });

  test('shutdown stops the pool and the schedule', () => {
    const ring = new RingBuffer(8);
    const executor = new BufferPaddingExecutor(ring, sequentialProvider(4), true);
    executor.setScheduleInterval(60);
    executor.start();
    executor.shutdown();
    // asyncPadding after shutdown is rejected, as ExecutorService.submit is.
    expect(() => { executor.asyncPadding(); }).toThrow();
    // Shutting down twice is a no-op, as the isShutdown guards make it upstream.
    expect(() => { executor.shutdown(); }).not.toThrow();
  });
});

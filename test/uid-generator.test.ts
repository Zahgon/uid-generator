/*
 * Tests for the two generators' own logic: bit configuration, `parseUID`, the
 * error surface, and the id stream `CachedUidGenerator` pre-computes.
 */

import { describe, expect, test, vi } from 'vitest';
import { CachedUidGenerator } from '../src/impl/cached-uid-generator.js';
import { DefaultUidGenerator } from '../src/impl/default-uid-generator.js';
import { UidGenerateException, throwableToString } from '../src/exception/uid-generate-exception.js';
import { Level, setRootLevel } from '../src/deps/slf4j/logger.js';
import type { WorkerIdAssigner } from '../src/worker/worker-id-assigner.js';

function fixedAssigner(workerId: bigint): WorkerIdAssigner {
  return { assignWorkerId: () => Promise.resolve(workerId) };
}

/**
 * Keep the component's own INFO chatter out of the test report. logback would
 * print it; the appender is not what these tests are about. An async body has
 * to be awaited inside the window, or the level is restored before it logs.
 */
async function quietly<T>(body: () => T | Promise<T>): Promise<T> {
  setRootLevel(Level.ERROR);
  try {
    return await body();
  } finally {
    setRootLevel(Level.DEBUG);
  }
}

function quietlySync<T>(body: () => T): T {
  setRootLevel(Level.ERROR);
  try {
    return body();
  } finally {
    setRootLevel(Level.DEBUG);
  }
}

/** Reach the protected members Spring reaches through property injection. */
class TestableDefault extends DefaultUidGenerator {
  callNextId(): bigint {
    return this.nextId();
  }

  getEpochSeconds(): bigint {
    return this.epochSeconds;
  }

  getEpochStr(): string {
    return this.epochStr;
  }

  setLastSecond(second: bigint): void {
    this.lastSecond = second;
  }
}

class TestableCached extends CachedUidGenerator {
  callNextIdsForOneSecond(second: bigint): bigint[] {
    return this.nextIdsForOneSecond(second);
  }
}

describe('DefaultUidGenerator', () => {
  test('carries the documented defaults before any setter runs', () => {
    const generator = new TestableDefault();
    expect(generator.getEpochStr()).toBe('2016-05-20');
    // The default is a fixed UTC constant, not a parse of the default string.
    expect(generator.getEpochSeconds()).toBe(1463673600n);
  });

  test('setters ignore a non-positive width and a blank epoch', async () => {
    const generator = new TestableDefault();
    generator.setTimeBits(0);
    generator.setWorkerBits(-1);
    generator.setSeqBits(0);
    generator.setEpochStr('   ');
    expect(generator.getEpochStr()).toBe('2016-05-20');
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());
    // Untouched: 1 + 28 + 22 + 13 = 64.
    expect(generator.parseUID(0n)).toContain('"workerId":"0"');
  });

  test('setEpochStr reparses the epoch in the default time zone', () => {
    const generator = new TestableDefault();
    generator.setEpochStr('2016-09-20');
    expect(generator.getEpochStr()).toBe('2016-09-20');
    expect(generator.getEpochSeconds()).toBe(1474329600n);
  });

  test('rejects a worker id above the allocator maximum', async () => {
    const generator = new DefaultUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setWorkerIdAssigner(fixedAssigner(2097152n));
    await expect(generator.afterPropertiesSet())
      .rejects.toThrow('Worker id 2097152 exceeds the max 2097151');
  });

  test('parseUID reproduces the JVM baseline string exactly', async () => {
    const generator = new DefaultUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());

    expect(generator.parseUID(5403393368917028148n)).toBe(
      '{"UID":"5403393368917028148","timestamp":"2026-09-08 06:21:29",'
      + '"workerId":"1","sequence":"3380"}',
    );
  });

  test('parseUID reads the fields back with unsigned shifts', async () => {
    const generator = new DefaultUidGenerator();
    generator.setWorkerIdAssigner(fixedAssigner(4194303n));
    // 28/22/13, the class defaults.
    await quietly(() => generator.afterPropertiesSet());
    const parsed = generator.parseUID(-1n);
    // Every field bit set: sign excluded, the three fields read at their maxima.
    expect(parsed).toContain('"workerId":"4194303"');
    expect(parsed).toContain('"sequence":"8191"');
  });

  test('generates strictly increasing ids and rolls the sequence within a second', async () => {
    const generator = new DefaultUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(7n));
    await quietly(() => generator.afterPropertiesSet());

    const first = generator.getUID();
    const second = generator.getUID();
    expect(first).toBeGreaterThan(0n);
    expect(second).toBe(first + 1n);
    expect(generator.parseUID(first)).toContain('"workerId":"7"');
  });

  test('refuses to generate when the clock moved backwards', async () => {
    // 29/21/13 from 2016-09-20: an allocation that has not expired, so the
    // clock check is the one that fires.
    const generator = new TestableDefault();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());
    generator.setLastSecond(BigInt(Math.trunc(Date.now() / 1000)) + 3n);
    expect(() => generator.callNextId())
      .toThrow('Clock moved backwards. Refusing for 3 seconds');
  });

  test('refuses to generate once the timestamp bits are exhausted', async () => {
    const generator = new DefaultUidGenerator();
    generator.setTimeBits(1);
    generator.setWorkerBits(49);
    generator.setSeqBits(13);
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());
    quietlySync(() => {
      expect(() => generator.getUID()).toThrow(UidGenerateException);
      expect(() => generator.getUID()).toThrow(/Timestamp bits is exhausted\. Refusing UID generate\. Now: \d+/);
    });
  });

  test('getUID wraps any failure as UidGenerateException', async () => {
    const generator = new DefaultUidGenerator();
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());
    const failure = new Error('inner');
    vi.spyOn(generator as unknown as { nextId(): bigint }, 'nextId').mockImplementation(() => {
      throw failure;
    });
    quietlySync(() => {
      expect(() => generator.getUID()).toThrow(UidGenerateException);
      expect(() => generator.getUID()).toThrow('Error: inner');
    });
    vi.restoreAllMocks();
  });
});

describe('CachedUidGenerator', () => {
  test('sizes the ring as (maxSequence + 1) << boostPower', async () => {
    const generator = new CachedUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(3n));
    await quietly(() => generator.afterPropertiesSet());
    try {
      expect(generator.getRingBuffer().getBufferSize()).toBe(65536);
      const uid = generator.getUID();
      expect(uid).toBeGreaterThan(0n);
      expect(generator.parseUID(uid)).toContain('"workerId":"3"');
    } finally {
      await generator.destroy();
    }
  });

  test('boostPower and scheduleInterval must be positive, handlers non-null', () => {
    const generator = new CachedUidGenerator();
    expect(() => { generator.setBoostPower(0); }).toThrow('Boost power must be positive!');
    expect(() => { generator.setScheduleInterval(0); }).toThrow('Schedule interval must positive!');
    expect(() => {
      generator.setRejectedPutBufferHandler(null as never);
    }).toThrow("RejectedPutBufferHandler can't be null!");
    expect(() => {
      generator.setRejectedTakeBufferHandler(null as never);
    }).toThrow("RejectedTakeBufferHandler can't be null!");
  });

  test('nextIdsForOneSecond returns maxSequence + 1 consecutive ids', async () => {
    const generator = new TestableCached();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(1n));
    await quietly(() => generator.afterPropertiesSet());
    try {
      const uids = generator.callNextIdsForOneSecond(1474329600n + 314518889n);
      expect(uids).toHaveLength(8192);
      expect(uids[0]).toBe(5403393368917024768n);
      expect(uids[3380]).toBe(5403393368917028148n);
      expect(uids[8191]).toBe(uids[0]! + 8191n);
    } finally {
      await generator.destroy();
    }
  });

  test('the shipped default bits emit negative ids after 2024-11-20', async () => {
    // Pinning the upstream behaviour that makes the unmodified
    // cached-uid-spring fixture fail today: no maxDeltaSeconds check runs on
    // this path, so the shift overflows into the sign bit.
    const generator = new TestableCached();
    generator.setWorkerIdAssigner(fixedAssigner(2n));
    await quietly(() => generator.afterPropertiesSet());
    try {
      const uids = generator.callNextIdsForOneSecond(1788848525n);
      expect(uids[0]).toBe(-7273818726875512832n);
      expect(uids[1]).toBe(-7273818726875512831n);
      expect(uids[0]!).toBeLessThan(0n);
    } finally {
      await generator.destroy();
    }
  });
});

describe('UidGenerateException', () => {
  test('supports the five upstream constructors', () => {
    expect(new UidGenerateException().message).toBe('');
    expect(throwableToString(new UidGenerateException())).toBe('UidGenerateException');
    expect(throwableToString(new UidGenerateException(''))).toBe('UidGenerateException: ');
    expect(new UidGenerateException('boom').message).toBe('boom');

    const cause = new Error('root');
    const withCause = new UidGenerateException('boom', cause);
    expect(withCause.message).toBe('boom');
    expect(withCause.cause).toBe(cause);

    const fromCause = new UidGenerateException(cause);
    expect(fromCause.message).toBe('Error: root');
    expect(fromCause.cause).toBe(cause);

    expect(new UidGenerateException('Clock moved backwards. Refusing for %d seconds', 5n).message)
      .toBe('Clock moved backwards. Refusing for 5 seconds');
  });

  test('carries the upstream serialVersionUID and is an Error', () => {
    expect(UidGenerateException.serialVersionUID).toBe(-27048199131316992n);
    expect(new UidGenerateException('x')).toBeInstanceOf(Error);
    expect(new UidGenerateException('x').name).toBe('UidGenerateException');
  });

  test('throwableToString renders Throwable.toString()', () => {
    expect(throwableToString(new Error('root'))).toBe('Error: root');
    // Java keeps a null message and an empty one apart —
    // `new RuntimeException()` renders without the colon, `new RuntimeException("")`
    // with it — and so does this.
    expect(throwableToString(new Error(''))).toBe('Error: ');
    expect(throwableToString(new Error())).toBe('Error');
    expect(throwableToString('plain')).toBe('plain');
  });
});

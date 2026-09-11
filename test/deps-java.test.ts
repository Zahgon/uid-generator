/*
 * Tests for behaviour the Java original got from the JDK and now has to
 * implement itself: 64-bit `long` arithmetic, the atomics, `String.format`, the
 * date patterns and `Date.toString()`.
 */

import { describe, expect, test } from 'vitest';
import {
  add, and, bitCount, not, or, shiftLeft, shiftRight, subtract, toLong,
  LONG_MAX_VALUE, LONG_MIN_VALUE, unsignedShiftRight,
} from '../src/deps/java/long.js';
import { AtomicBoolean, AtomicInteger, AtomicLong } from '../src/deps/java/atomic.js';
import {
  IllegalFormatConversionException, MissingFormatArgumentException, format,
} from '../src/deps/java/string-format.js';
import {
  ParseException, dateToString, formatPattern, parsePattern, shortTimeZoneName,
} from '../src/deps/java/java-date.js';
import { TimeUnit } from '../src/deps/java/time-unit.js';
import { Thread, runAsThread } from '../src/deps/java/thread.js';
import { Executors, RejectedExecutionException } from '../src/deps/java/executors.js';
import { NamingThreadFactory } from '../src/utils/naming-thread-factory.js';

describe('java long arithmetic', () => {
  test('shifts take their distance modulo 64', () => {
    expect(shiftLeft(-1n, 64)).toBe(-1n);
    expect(not(shiftLeft(-1n, 64))).toBe(0n);
    expect(shiftLeft(1n, 65)).toBe(2n);
    expect(unsignedShiftRight(-1n, 64)).toBe(-1n);
  });

  test('the max-value masks match the three default bit widths', () => {
    expect(not(shiftLeft(-1n, 28))).toBe(268435455n);
    expect(not(shiftLeft(-1n, 22))).toBe(4194303n);
    expect(not(shiftLeft(-1n, 13))).toBe(8191n);
  });

  test('a left shift overflows into the sign bit instead of growing', () => {
    // 2016-05-20 epoch, 28 timestamp bits, second 1788848525: the delta needs
    // 29 bits and wraps.
    expect(shiftLeft(325174925n, 35)).toBe(-7273818726875529216n);
  });

  test('arithmetic wraps at the 64-bit boundary', () => {
    expect(add(LONG_MAX_VALUE, 1n)).toBe(LONG_MIN_VALUE);
    expect(subtract(LONG_MIN_VALUE, 1n)).toBe(LONG_MAX_VALUE);
    expect(toLong(2n ** 64n)).toBe(0n);
  });

  test('unsigned and arithmetic right shift differ on a negative value', () => {
    expect(shiftRight(-8n, 1)).toBe(-4n);
    expect(unsignedShiftRight(-8n, 1)).toBe(9223372036854775804n);
  });

  test('or and and behave as 64-bit bitwise operators', () => {
    expect(or(0b1010n, 0b0101n)).toBe(0b1111n);
    expect(and(8191n + 1n, 8191n)).toBe(0n);
  });

  test('bitCount recognises the powers of two RingBuffer requires', () => {
    expect(bitCount(65536)).toBe(1);
    expect(bitCount(65535)).toBe(16);
    expect(bitCount(0)).toBe(0);
  });
});

describe('atomics', () => {
  test('AtomicLong wraps and reports the new value from updateAndGet', () => {
    const value = new AtomicLong(LONG_MAX_VALUE);
    expect(value.incrementAndGet()).toBe(LONG_MIN_VALUE);
    expect(value.getAndIncrement()).toBe(LONG_MIN_VALUE);
    expect(value.get()).toBe(LONG_MIN_VALUE + 1n);
    expect(value.updateAndGet(() => 7n)).toBe(7n);
    expect(value.getAndUpdate(() => 9n)).toBe(7n);
    expect(value.toString()).toBe('9');
  });

  test('compareAndSet only fires on an exact match', () => {
    const value = new AtomicLong(1n);
    expect(value.compareAndSet(2n, 3n)).toBe(false);
    expect(value.compareAndSet(1n, 3n)).toBe(true);
    expect(value.get()).toBe(3n);
  });

  test('AtomicInteger truncates to 32 bits', () => {
    const value = new AtomicInteger(2147483647);
    expect(value.incrementAndGet()).toBe(-2147483648);
  });

  test('AtomicBoolean guards a single-flight section', () => {
    const running = new AtomicBoolean(false);
    expect(running.compareAndSet(false, true)).toBe(true);
    expect(running.compareAndSet(false, true)).toBe(false);
    expect(running.compareAndSet(true, false)).toBe(true);
  });
});

describe('String.format subset', () => {
  test('renders the parseUID template', () => {
    expect(format(
      '{"UID":"%d","timestamp":"%s","workerId":"%d","sequence":"%d"}',
      5403393368917028148n, '2026-09-08 06:21:29', 1n, 3380n,
    )).toBe('{"UID":"5403393368917028148","timestamp":"2026-09-08 06:21:29","workerId":"1","sequence":"3380"}');
  });

  test('renders the clock-moved-backwards message', () => {
    expect(format('Clock moved backwards. Refusing for %d seconds', 3n))
      .toBe('Clock moved backwards. Refusing for 3 seconds');
  });

  test('%% is an escape and %d rejects a non-integral argument', () => {
    expect(format('100%%')).toBe('100%');
    expect(() => format('%d', 1.5)).toThrow(IllegalFormatConversionException);
    expect(() => format('%d')).toThrow(MissingFormatArgumentException);
  });
});

describe('date patterns', () => {
  test('formats the three DateUtils patterns', () => {
    const date = new Date(2026, 8, 8, 6, 21, 29, 45);
    expect(formatPattern(date, 'yyyy-MM-dd')).toBe('2026-09-08');
    expect(formatPattern(date, 'yyyy-MM-dd HH:mm:ss')).toBe('2026-09-08 06:21:29');
    expect(formatPattern(date, 'yyyy-MM-dd HH:mm:ss.SSS')).toBe('2026-09-08 06:21:29.045');
    expect(formatPattern(date, 'HH:mm:ss.SSS')).toBe('06:21:29.045');
  });

  test('parses a day and rejects trailing input', () => {
    const parsed = parsePattern('2016-09-20', 'yyyy-MM-dd');
    expect(parsed?.getFullYear()).toBe(2016);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(20);
    expect(parsed?.getHours()).toBe(0);
    expect(parsePattern('2016-09-20x', 'yyyy-MM-dd')).toBeNull();
    expect(parsePattern('not-a-date', 'yyyy-MM-dd')).toBeNull();
  });

  test('parses leniently, rolling an out-of-range component over', () => {
    const parsed = parsePattern('2016-13-01', 'yyyy-MM-dd');
    expect(parsed?.getFullYear()).toBe(2017);
    expect(parsed?.getMonth()).toBe(0);
  });

  test('ParseException carries the commons-lang message', () => {
    const error = new ParseException('Unable to parse the date: nope', -1);
    expect(error.message).toBe('Unable to parse the date: nope');
    expect(error.name).toBe('ParseException');
  });

  test('Date.toString renders EEE MMM dd HH:mm:ss zzz yyyy', () => {
    // TZ is pinned to UTC for the suite, so this matches the JVM baseline.
    expect(shortTimeZoneName(new Date(0))).toBe('UTC');
    expect(dateToString(new Date(Date.UTC(2026, 8, 8, 6, 21, 5))))
      .toBe('Tue Sep 08 06:21:05 UTC 2026');
  });
});

describe('TimeUnit', () => {
  test('truncates toward zero', () => {
    expect(TimeUnit.MILLISECONDS.toSeconds(1463673600000n)).toBe(1463673600n);
    expect(TimeUnit.MILLISECONDS.toSeconds(1999n)).toBe(1n);
    expect(TimeUnit.SECONDS.toMillis(1463673600n)).toBe(1463673600000n);
  });
});

describe('Thread', () => {
  test('a task sees its own name across an await', async () => {
    const seen: string[] = [];
    const thread = new Thread(async () => {
      seen.push(Thread.currentThread().getName());
      await Promise.resolve();
      seen.push(Thread.currentThread().getName());
    }, 'UID-generator-0');
    thread.start();
    await thread.join();
    expect(seen).toEqual(['UID-generator-0', 'UID-generator-0']);
    expect(Thread.currentThread().getName()).toBe('main');
  });

  test('an escaping error reaches the uncaught-exception handler', async () => {
    const caught: unknown[] = [];
    const thread = new Thread(() => {
      throw new Error('boom');
    }, 'worker');
    thread.setUncaughtExceptionHandler((_t, e) => caught.push(e));
    thread.start();
    await thread.join();
    expect((caught[0] as Error).message).toBe('boom');
  });

  test('a thread cannot be started twice', () => {
    const thread = new Thread(() => undefined);
    thread.start();
    expect(() => { thread.start(); }).toThrow('IllegalThreadStateException');
  });

  test('runAsThread borrows an identity for a synchronous body', () => {
    const thread = new Thread(null, 'RingBuffer-Padding-Worker-1');
    expect(runAsThread(thread, () => Thread.currentThread().getName()))
      .toBe('RingBuffer-Padding-Worker-1');
  });
});

describe('executors', () => {
  test('a fixed pool names its workers through the factory', () => {
    const pool = Executors.newFixedThreadPool(2, new NamingThreadFactory('RingBuffer-Padding-Worker'));
    const names: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      pool.submit(() => { names.push(Thread.currentThread().getName()); });
    }
    expect(names).toEqual([
      'RingBuffer-Padding-Worker-1',
      'RingBuffer-Padding-Worker-2',
      'RingBuffer-Padding-Worker-1',
      'RingBuffer-Padding-Worker-2',
    ]);
  });

  test('submitting after shutdownNow is rejected', () => {
    const pool = Executors.newFixedThreadPool(1, new NamingThreadFactory('pool'));
    expect(pool.isShutdown()).toBe(false);
    pool.shutdownNow();
    expect(pool.isShutdown()).toBe(true);
    expect(() => { pool.submit(() => undefined); }).toThrow(RejectedExecutionException);
  });

  test('a task error goes to the worker uncaught handler, not the caller', () => {
    const caught: unknown[] = [];
    const factory = new NamingThreadFactory('pool');
    factory.setUncaughtExceptionHandler((_t, e) => caught.push(e));
    const pool = Executors.newFixedThreadPool(1, factory);
    pool.submit(() => {
      throw new Error('padding failed');
    });
    expect((caught[0] as Error).message).toBe('padding failed');
  });

  test('a fixed-delay schedule runs and then stops on shutdownNow', async () => {
    const schedule = Executors.newSingleThreadScheduledExecutor(
      new NamingThreadFactory('RingBuffer-Padding-Schedule'),
    );
    const runs: string[] = [];
    schedule.scheduleWithFixedDelay(
      () => { runs.push(Thread.currentThread().getName()); },
      0.001,
      0.001,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    schedule.shutdownNow();
    const afterShutdown = runs.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]).toBe('RingBuffer-Padding-Schedule-1');
    expect(runs.length).toBe(afterShutdown);
    expect(schedule.isShutdown()).toBe(true);
  });
});

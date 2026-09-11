/*
 * Tests for the `utils` package: the date facade, the padded atomic, and the
 * thread factory whose names reach the log through `%thread`.
 */

import { describe, expect, test } from 'vitest';
import { DateUtils } from '../src/utils/date-utils.js';
import { PaddedAtomicLong } from '../src/utils/padded-atomic-long.js';
import { NamingThreadFactory } from '../src/utils/naming-thread-factory.js';
import { Thread } from '../src/deps/java/thread.js';
import { Level, setRootLevel } from '../src/deps/slf4j/logger.js';

describe('DateUtils', () => {
  test('exposes the three patterns and the 1970-01-01 default date', () => {
    expect(DateUtils.DAY_PATTERN).toBe('yyyy-MM-dd');
    expect(DateUtils.DATETIME_PATTERN).toBe('yyyy-MM-dd HH:mm:ss');
    expect(DateUtils.DATETIME_MS_PATTERN).toBe('yyyy-MM-dd HH:mm:ss.SSS');
    expect(DateUtils.formatByDayPattern(DateUtils.DEFAULT_DATE)).toBe('1970-01-01');
  });

  test('parses and formats the epoch strings the generators use', () => {
    // Note the asymmetry the port has to preserve: DefaultUidGenerator's
    // *default* epochSeconds is the hard-coded 1463673600 (2016-05-20 in
    // Asia/Shanghai), while setEpochStr parses in the default zone.
    expect(DateUtils.parseByDayPattern('2016-05-20').getTime()).toBe(1463702400000);
    expect(DateUtils.parseByDayPattern('2016-09-20').getTime()).toBe(1474329600000);
    expect(DateUtils.parseByDateTimePattern('2026-09-08 06:21:29').getTime())
      .toBe(Date.UTC(2026, 8, 8, 6, 21, 29));
  });

  test('formatByDayPattern is null-safe; formatByDateTimePattern is not', () => {
    expect(DateUtils.formatByDayPattern(null)).toBeNull();
    expect(DateUtils.formatByDayPattern(undefined)).toBeNull();
    expect(() => DateUtils.formatByDateTimePattern(null as never)).toThrow();
  });

  test('formatDate takes an arbitrary supported pattern', () => {
    const date = new Date(Date.UTC(2026, 8, 8, 6, 21, 29, 45));
    expect(DateUtils.formatDate(date, DateUtils.DATETIME_MS_PATTERN))
      .toBe('2026-09-08 06:21:29.045');
  });

  test('an unparseable string surfaces as a runtime error', () => {
    expect(() => DateUtils.parseByDayPattern('2016-05-20x')).toThrow(/Unable to parse the date/);
    expect(() => DateUtils.parseByDayPattern('not-a-date')).toThrow(/Unable to parse the date/);
  });

  test('parses leniently, as commons-lang configures SimpleDateFormat', () => {
    // A rolled-over day may carry the year with it; both values are the JVM's.
    expect(DateUtils.parseByDayPattern('2016-13-01').getTime()).toBe(1483228800000);
    expect(DateUtils.parseByDayPattern('2016-02-30').getTime()).toBe(1456790400000);
  });

  test('getCurrentDayByDayPattern renders today', () => {
    expect(DateUtils.getCurrentDayByDayPattern())
      .toBe(DateUtils.formatByDayPattern(new Date()));
  });
});

describe('PaddedAtomicLong', () => {
  test('is an AtomicLong whose padding sums to 7', () => {
    const value = new PaddedAtomicLong(-1n);
    expect(value.get()).toBe(-1n);
    expect(value.incrementAndGet()).toBe(0n);
    expect(value.sumPaddingToPreventOptimization()).toBe(7n);
    expect(new PaddedAtomicLong().get()).toBe(0n);
    expect(PaddedAtomicLong.serialVersionUID).toBe(-3415778863941386253n);
  });
});

describe('NamingThreadFactory', () => {
  test('names threads prefix-N with a per-prefix counter starting at 1', () => {
    const factory = new NamingThreadFactory('RingBuffer-Padding-Worker');
    expect(factory.newThread(() => undefined).getName()).toBe('RingBuffer-Padding-Worker-1');
    expect(factory.newThread(() => undefined).getName()).toBe('RingBuffer-Padding-Worker-2');
    expect(new NamingThreadFactory('RingBuffer-Padding-Schedule').newThread(() => undefined).getName())
      .toBe('RingBuffer-Padding-Schedule-1');
  });

  test('with no prefix it detects the calling class', () => {
    // The class is the point: getInvoker reads the calling frame's owner.
    class PaddingCaller {
      make(factory: NamingThreadFactory): Thread {
        return factory.newThread(() => undefined);
      }
    }
    expect(new PaddingCaller().make(new NamingThreadFactory()).getName())
      .toBe('PaddingCaller-1');
    // A blank prefix is treated as no prefix, as StringUtils.isBlank decides.
    expect(new NamingThreadFactory('   ').newThread(() => undefined).getName())
      .toMatch(/-1$/);
  });

  test('a static caller still yields an identifying prefix on every V8', () => {
    // V8 before v13 reports a static method's receiver as `Function`, which
    // names nothing; the factory falls back to the method name there and uses
    // the class name where V8 supplies it.
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class StaticCaller {
      static make(factory: NamingThreadFactory): Thread {
        return factory.newThread(() => undefined);
      }
    }
    const name = StaticCaller.make(new NamingThreadFactory()).getName();
    expect(name).toMatch(/^(StaticCaller|make)-1$/);
  });

  test('carries the daemon flag onto every thread it makes', () => {
    const factory = new NamingThreadFactory('worker', true);
    expect(factory.isDaemon()).toBe(true);
    expect(factory.newThread(() => undefined).isDaemon()).toBe(true);
    factory.setDaemon(false);
    expect(factory.newThread(() => undefined).isDaemon()).toBe(false);
  });

  test('installs the supplied uncaught-exception handler, else a logging one', async () => {
    const caught: unknown[] = [];
    const factory = new NamingThreadFactory('worker');
    factory.setUncaughtExceptionHandler((_t, e) => caught.push(e));
    expect(factory.getUncaughtExceptionHandler()).not.toBeNull();
    const explicit = factory.newThread(() => {
      throw new Error('boom');
    });
    explicit.start();
    await explicit.join();
    expect((caught[0] as Error).message).toBe('boom');

    factory.setUncaughtExceptionHandler(null);
    setRootLevel(Level.ERROR);
    const logging = factory.newThread(() => {
      throw new Error('logged');
    });
    logging.start();
    await logging.join();
    setRootLevel(Level.DEBUG);
  });

  test('name and prefix are readable back off the factory', () => {
    const factory = new NamingThreadFactory('a');
    expect(factory.getName()).toBe('a');
    factory.setName('b');
    expect(factory.newThread(() => undefined).getName()).toBe('b-1');
  });
});

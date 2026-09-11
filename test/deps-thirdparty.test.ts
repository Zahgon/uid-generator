/*
 * Tests for behaviour the Java original got from commons-lang, Spring and
 * slf4j/logback, and now implements itself.
 */

import { describe, expect, test } from 'vitest';
import { StringUtils, isWhitespace } from '../src/deps/commons-lang/string-utils.js';
import { ClassUtils } from '../src/deps/commons-lang/class-utils.js';
import { RandomUtils } from '../src/deps/commons-lang/random-utils.js';
import { DateFormatUtils, parseDate } from '../src/deps/commons-lang/date-utils.js';
import {
  ReflectionToStringBuilder, SHORT_PREFIX_STYLE, ToStringBuilder,
} from '../src/deps/commons-lang/to-string-builder.js';
import { Assert, IllegalArgumentException } from '../src/deps/spring/assert.js';
import {
  Level, LoggerFactory, abbreviateLoggerName, formatMessage, getRootLevel,
  resetAppender, setAppender, setRootLevel,
} from '../src/deps/slf4j/logger.js';
import { parseProperties, requireProperty } from '../src/db/properties.js';

describe('StringUtils', () => {
  test('isBlank matches commons-lang, including the ASCII separators', () => {
    expect(StringUtils.isBlank(null)).toBe(true);
    expect(StringUtils.isBlank(undefined)).toBe(true);
    expect(StringUtils.isBlank('')).toBe(true);
    expect(StringUtils.isBlank('  \t\n')).toBe(true);
    // Character.isWhitespace accepts the four ASCII information separators.
    expect(StringUtils.isBlank('\u001c\u001d\u001e\u001f')).toBe(true);
    expect(StringUtils.isBlank(' a ')).toBe(false);
    expect(StringUtils.isNotBlank('2016-05-20')).toBe(true);
  });

  test('a non-breaking space is not whitespace to Character.isWhitespace', () => {
    expect(isWhitespace('\u00a0')).toBe(false);
    expect(isWhitespace('\u2007')).toBe(false);
    expect(isWhitespace('\u202f')).toBe(false);
    expect(isWhitespace('\ufeff')).toBe(false);
    expect(StringUtils.isBlank('\u00a0')).toBe(false);
    expect(isWhitespace('\u2003')).toBe(true);
  });
});

describe('ClassUtils.getShortClassName', () => {
  test('strips the package and re-spells a nested class', () => {
    expect(ClassUtils.getShortClassName('com.baidu.fsg.uid.buffer.RingBuffer')).toBe('RingBuffer');
    expect(ClassUtils.getShortClassName('a.b.Outer$Inner')).toBe('Outer.Inner');
    expect(ClassUtils.getShortClassName('RingBuffer')).toBe('RingBuffer');
    expect(ClassUtils.getShortClassName(null)).toBe('');
  });
});

describe('RandomUtils.nextInt', () => {
  test('stays inside [0, n) and rejects a non-positive bound', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = RandomUtils.nextInt(100000);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(100000);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(() => RandomUtils.nextInt(0)).toThrow();
    expect(() => RandomUtils.nextInt(-1)).toThrow();
  });
});

describe('commons-lang date helpers', () => {
  test('parseDate takes the first pattern that consumes the input', () => {
    const parsed = parseDate('2016-05-20', ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd']);
    expect(DateFormatUtils.format(parsed, 'yyyy-MM-dd HH:mm:ss')).toBe('2016-05-20 00:00:00');
  });

  test('parseDate reports the commons-lang failure message', () => {
    expect(() => parseDate('not-a-date', ['yyyy-MM-dd']))
      .toThrow('Unable to parse the date: not-a-date');
    // Trailing input the pattern did not consume is also a failure.
    expect(() => parseDate('2016-05-20x', ['yyyy-MM-dd']))
      .toThrow('Unable to parse the date: 2016-05-20x');
  });
});

describe('ToStringStyle.SHORT_PREFIX_STYLE', () => {
  class Sample {
    constructor(
      public first = 1,
      public second: string | null = null,
      public third: bigint = 8191n,
      public when: Date | null = new Date(Date.UTC(2026, 8, 8, 6, 21, 5)),
      public list: number[] = [1, 2],
    ) {}
  }

  test('renders name, brackets, separators, nulls and arrays', () => {
    expect(ToStringBuilder.reflectionToString(new Sample(), SHORT_PREFIX_STYLE)).toBe(
      'Sample[first=1,second=<null>,third=8191,when=Tue Sep 08 06:21:05 UTC 2026,list={1,2}]',
    );
  });

  test('ReflectionToStringBuilder.toString is the same rendering', () => {
    expect(ReflectionToStringBuilder.toString(new Sample()))
      .toBe(ToStringBuilder.reflectionToString(new Sample()));
  });
});

describe('Spring Assert', () => {
  test('isTrue and notNull raise IllegalArgumentException with the given message', () => {
    expect(() => { Assert.isTrue(false, 'allocate not enough 64 bits'); })
      .toThrow(IllegalArgumentException);
    expect(() => { Assert.isTrue(false, 'RingBuffer size must be a power of 2'); })
      .toThrow('RingBuffer size must be a power of 2');
    expect(() => { Assert.notNull(null, "RejectedPutBufferHandler can't be null!"); })
      .toThrow("RejectedPutBufferHandler can't be null!");
    expect(() => { Assert.isTrue(true, 'fine'); }).not.toThrow();
    expect(() => { Assert.notNull(0, 'fine'); }).not.toThrow();
  });
});

describe('logback default layout', () => {
  test('%logger{36} abbreviates exactly as the JVM baseline printed it', () => {
    expect(abbreviateLoggerName('com.baidu.fsg.uid.buffer.RingBuffer'))
      .toBe('com.baidu.fsg.uid.buffer.RingBuffer');
    expect(abbreviateLoggerName('com.baidu.fsg.uid.impl.DefaultUidGenerator'))
      .toBe('c.b.fsg.uid.impl.DefaultUidGenerator');
    expect(abbreviateLoggerName('com.baidu.fsg.uid.impl.CachedUidGenerator'))
      .toBe('c.b.fsg.uid.impl.CachedUidGenerator');
    expect(abbreviateLoggerName('com.baidu.fsg.uid.worker.DisposableWorkerIdAssigner'))
      .toBe('c.b.f.u.w.DisposableWorkerIdAssigner');
    expect(abbreviateLoggerName('RingBuffer')).toBe('RingBuffer');
  });

  test('{} anchors are filled positionally and a leftover argument is the throwable', () => {
    expect(formatMessage('Initialized bits(1, {}, {}, {}) for workerID:{}', [28, 22, 13, 2n]))
      .toEqual({ message: 'Initialized bits(1, 28, 22, 13) for workerID:2', throwable: undefined });
    const error = new Error('boom');
    expect(formatMessage('Generate unique id exception. ', [error]).throwable).toBe(error);
    expect(formatMessage('a {} b', [null]).message).toBe('a null b');
  });

  test('a line carries the timestamp, thread, padded level and logger name', () => {
    const lines: string[] = [];
    setAppender((line) => lines.push(line));
    try {
      const logger = LoggerFactory.getLogger('com.baidu.fsg.uid.buffer.RingBuffer');
      logger.info('Rejected take buffer. {}', 'RingBuffer [bufferSize=8]');
      logger.warn('warned');
      logger.error('errored');
    } finally {
      resetAppender();
    }
    expect(lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} \[main] INFO {2}com\.baidu\.fsg\.uid\.buffer\.RingBuffer - Rejected take buffer\. RingBuffer \[bufferSize=8]\n$/,
    );
    expect(lines[1]).toContain('] WARN  com.baidu.fsg.uid.buffer.RingBuffer - warned');
    expect(lines[2]).toContain('] ERROR com.baidu.fsg.uid.buffer.RingBuffer - errored');
  });

  test('an emitted line really is abbreviated, not just abbreviateLoggerName()', () => {
    // The line above uses a 35-character name, which %logger{36} leaves alone —
    // so it cannot tell whether the layout calls the abbreviator at all. This
    // one is 42 characters, and the JVM baseline printed it shortened.
    const lines: string[] = [];
    setAppender((line) => lines.push(line));
    try {
      LoggerFactory.getLogger('com.baidu.fsg.uid.impl.CachedUidGenerator')
        .info('Initialized RingBuffer successfully.');
      LoggerFactory.getLogger('com.baidu.fsg.uid.worker.DisposableWorkerIdAssigner')
        .info('Add worker node:x');
    } finally {
      resetAppender();
    }
    expect(lines[0]).toContain(
      'INFO  c.b.fsg.uid.impl.CachedUidGenerator - Initialized RingBuffer successfully.\n',
    );
    expect(lines[0]).not.toContain('com.baidu.fsg.uid.impl.CachedUidGenerator');
    expect(lines[1]).toContain('INFO  c.b.f.u.w.DisposableWorkerIdAssigner - Add worker node:x\n');
  });

  test('the root level defaults to DEBUG, as an unconfigured logback does', () => {
    expect(getRootLevel()).toBe(Level.DEBUG);
    const lines: string[] = [];
    setAppender((line) => lines.push(line));
    try {
      const logger = LoggerFactory.getLogger('x.Y');
      logger.debug('kept');
      setRootLevel(Level.WARN);
      logger.info('dropped');
      logger.warn('kept too');
      expect(logger.isInfoEnabled()).toBe(false);
      expect(logger.isWarnEnabled()).toBe(true);
    } finally {
      setRootLevel(Level.DEBUG);
      resetAppender();
    }
    expect(lines).toHaveLength(2);
  });

  test('getLogger returns the same instance for the same name', () => {
    expect(LoggerFactory.getLogger('a.B')).toBe(LoggerFactory.getLogger('a.B'));
  });
});

describe('properties files', () => {
  test('parses the shipped mysql.properties format', () => {
    const properties = parseProperties([
      '#datasource db info',
      'mysql.driver=com.mysql.jdbc.Driver',
      'jdbc.url=jdbc:mysql://localhost:xxxx/xxxx',
      'jdbc.maxActive=2',
      '',
      '! another comment',
      'datasource.validationQuery=SELECT 1 FROM DUAL',
    ].join('\n'));
    expect(requireProperty(properties, 'jdbc.url')).toBe('jdbc:mysql://localhost:xxxx/xxxx');
    expect(requireProperty(properties, 'datasource.validationQuery')).toBe('SELECT 1 FROM DUAL');
    expect(properties.has('#datasource db info')).toBe(false);
    expect(() => requireProperty(properties, 'nope'))
      .toThrow("Could not resolve placeholder 'nope'");
  });

  test('supports the colon separator and line continuations', () => {
    const properties = parseProperties('a:1\nb = 2\nc=x\\\n   y\n');
    expect(properties.get('a')).toBe('1');
    expect(properties.get('b')).toBe('2');
    expect(properties.get('c')).toBe('xy');
  });
});

/*
 * The package's public surface, and the corners of the shims the component's
 * own code paths do not happen to reach.
 *
 * The Java original's surface is its public classes and their public methods;
 * `src/index.ts` is where the port publishes the same set, so the barrel gets
 * exercised rather than only type-checked.
 */

import { describe, expect, test } from 'vitest';
import * as uidGenerator from '../src/index.js';
import { AtomicInteger, AtomicLong } from '../src/deps/java/atomic.js';
import { javaToString } from '../src/deps/java/to-string.js';
import { parseProperties } from '../src/db/properties.js';
import { LONG_MAX_VALUE, LONG_MIN_VALUE } from '../src/deps/java/long.js';

describe('public API', () => {
  test('publishes every class the Java original made public', () => {
    for (const name of [
      'BitsAllocator',
      'UidGenerateException',
      'DefaultUidGenerator',
      'CachedUidGenerator',
      'RingBuffer',
      'BufferPaddingExecutor',
      'DisposableWorkerIdAssigner',
      'WorkerNodeType',
      'WorkerNodeEntity',
      'NamingThreadFactory',
      'PaddedAtomicLong',
      'DateUtils',
      'DockerUtils',
      'EnumUtils',
      'NetUtils',
    ]) {
      expect(uidGenerator).toHaveProperty(name);
      expect(uidGenerator[name as keyof typeof uidGenerator]).toBeDefined();
    }
  });

  test('publishes the replacements for the MyBatis/Druid layer', () => {
    for (const name of [
      'SqlWorkerNodeDAO',
      'addWorkerNodeSql',
      'getWorkerNodeByHostPortSql',
      'mapWorkerNode',
      'MYSQL_DIALECT',
      'SQLITE_DIALECT',
      'openSqlSession',
      'MysqlSqlSession',
      'SqliteSqlSession',
      'loadProperties',
      'parseProperties',
    ]) {
      expect(uidGenerator).toHaveProperty(name);
    }
  });

  test('a generator constructed off the barrel produces a parseable id', async () => {
    const generator = new uidGenerator.CachedUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner({ assignWorkerId: () => Promise.resolve(11n) });
    uidGenerator.setRootLevel(uidGenerator.Level.ERROR);
    try {
      await generator.afterPropertiesSet();
      const uid = generator.getUID();
      expect(uid).toBeGreaterThan(0n);
      expect(generator.parseUID(uid)).toContain('"workerId":"11"');
    } finally {
      await generator.destroy();
      uidGenerator.setRootLevel(uidGenerator.Level.DEBUG);
    }
  });
});

describe('AtomicLong, the rest of the surface', () => {
  test('getAndSet, decrementAndGet and addAndGet wrap like a Java long', () => {
    const value = new AtomicLong(5n);
    expect(value.getAndSet(9n)).toBe(5n);
    expect(value.get()).toBe(9n);
    expect(value.decrementAndGet()).toBe(8n);
    expect(value.addAndGet(-8n)).toBe(0n);

    const low = new AtomicLong(LONG_MIN_VALUE);
    expect(low.decrementAndGet()).toBe(LONG_MAX_VALUE);
    expect(new AtomicLong(LONG_MAX_VALUE).addAndGet(1n)).toBe(LONG_MIN_VALUE);
    // The constructor truncates too.
    expect(new AtomicLong(2n ** 64n + 3n).get()).toBe(3n);
  });

  test('AtomicInteger set and compareAndSet truncate to 32 bits', () => {
    const value = new AtomicInteger();
    expect(value.get()).toBe(0);
    value.set(2147483648);
    expect(value.get()).toBe(-2147483648);
    expect(value.compareAndSet(0, 1)).toBe(false);
    expect(value.compareAndSet(-2147483648, 7)).toBe(true);
    expect(value.toString()).toBe('7');
  });
});

describe('String.valueOf', () => {
  test('renders each kind of value the way Java does', () => {
    expect(javaToString(null)).toBe('null');
    expect(javaToString(undefined)).toBe('null');
    expect(javaToString('text')).toBe('text');
    expect(javaToString(42)).toBe('42');
    expect(javaToString(42n)).toBe('42');
    expect(javaToString(true)).toBe('true');
    expect(javaToString(new uidGenerator.BitsAllocator(29, 21, 13)))
      .toContain('BitsAllocator[signBits=1');
  });

  test('falls back to JSON for an object with no rendering of its own', () => {
    // Java would print "java.lang.Object@1b6d3586" here; the port refuses to
    // invent an identity hash and prints the state instead.
    expect(javaToString({ a: 1 })).toBe('{"a":1}');
    expect(javaToString(function named() { /* nothing */ })).toBe('named');
    expect(javaToString(Symbol('s'))).toBe('Symbol(s)');
  });
});

describe('properties escapes', () => {
  test('decodes the backslash escapes java.util.Properties accepts', () => {
    const properties = parseProperties([
      'a=line\\nbreak',
      'b=tab\\there',
      'c=carriage\\rreturn',
      'd=form\\ffeed',
      'e=\\u0041\\u0042',
      'f=colon\\:in\\=key',
      'g',
    ].join('\n'));
    expect(properties.get('a')).toBe('line\nbreak');
    expect(properties.get('b')).toBe('tab\there');
    expect(properties.get('c')).toBe('carriage\rreturn');
    expect(properties.get('d')).toBe('form\ffeed');
    expect(properties.get('e')).toBe('AB');
    expect(properties.get('f')).toBe('colon:in=key');
    // A bare key with no separator has an empty value.
    expect(properties.get('g')).toBe('');
  });
});

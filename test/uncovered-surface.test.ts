/*
 * The remaining public surface of the shims and the generators — the members
 * the component's own code paths never happen to call, but which are part of
 * what the Java originals expose and so are part of what the port must get
 * right.
 */

import { describe, expect, test } from 'vitest';
import { AtomicBoolean, AtomicInteger, AtomicLong } from '../src/deps/java/atomic.js';
import { PaddedAtomicLong } from '../src/utils/padded-atomic-long.js';
import { Thread } from '../src/deps/java/thread.js';
import {
  Level, LoggerFactory, getRootLevel, resetAppender, setAppender, setRootLevel,
} from '../src/deps/slf4j/logger.js';
import { CachedUidGenerator } from '../src/impl/cached-uid-generator.js';
import { mysqlConnectionOptions, openMysqlSqlSession } from '../src/db/mysql-sql-session.js';
import type { MysqlConnection, MysqlConnectionOptions } from '../src/db/mysql-sql-session.js';
import { MYSQL_DIALECT } from '../src/db/sql-session.js';
import type { WorkerIdAssigner } from '../src/worker/worker-id-assigner.js';

function fixedAssigner(workerId: bigint): WorkerIdAssigner {
  return { assignWorkerId: () => Promise.resolve(workerId) };
}

describe('AtomicLong.set and the atomic toString methods', () => {
  test('set truncates to 64 bits and toString renders Long.toString', () => {
    const value = new AtomicLong(1n);
    value.set(2n ** 63n); // one past Long.MAX_VALUE
    expect(value.get()).toBe(-(2n ** 63n));
    value.set(-1n);
    expect(value.toString()).toBe('-1');
    expect(new PaddedAtomicLong(42n).toString()).toBe('42');
  });

  test('AtomicBoolean and AtomicInteger render like their Java counterparts', () => {
    expect(new AtomicBoolean(true).toString()).toBe('true');
    expect(new AtomicBoolean().toString()).toBe('false');
    const flag = new AtomicBoolean(false);
    flag.set(true);
    expect(flag.get()).toBe(true);
    expect(new AtomicInteger(-7).toString()).toBe('-7');
  });
});

describe('Thread.toString', () => {
  test('renders Thread[name,priority,group] as the JVM does', () => {
    expect(new Thread(null, 'RingBuffer-Padding-Worker-1').toString())
      .toBe('Thread[RingBuffer-Padding-Worker-1,5,main]');
    expect(Thread.currentThread().toString()).toBe('Thread[main,5,main]');
  });

  test('an unnamed thread gets the JVM default Thread-N name', () => {
    expect(new Thread(() => undefined).getName()).toMatch(/^Thread-\d+$/);
  });
});

describe('Logger level predicates and the default appender', () => {
  test('every predicate answers against the root level', () => {
    const logger = LoggerFactory.getLogger('com.baidu.fsg.uid.buffer.RingBuffer');
    expect(getRootLevel()).toBe(Level.DEBUG);
    expect(logger.isTraceEnabled()).toBe(false);
    expect(logger.isDebugEnabled()).toBe(true);
    expect(logger.isInfoEnabled()).toBe(true);
    expect(logger.isWarnEnabled()).toBe(true);
    expect(logger.isErrorEnabled()).toBe(true);

    setRootLevel(Level.TRACE);
    try {
      expect(logger.isTraceEnabled()).toBe(true);
    } finally {
      setRootLevel(Level.DEBUG);
    }

    setRootLevel(Level.ERROR);
    try {
      expect(logger.isDebugEnabled()).toBe(false);
      expect(logger.isInfoEnabled()).toBe(false);
      expect(logger.isWarnEnabled()).toBe(false);
      expect(logger.isErrorEnabled()).toBe(true);
    } finally {
      setRootLevel(Level.DEBUG);
    }
  });

  test('trace() emits at TRACE and is dropped at the default level', () => {
    const lines: string[] = [];
    setAppender((line) => lines.push(line));
    try {
      const logger = LoggerFactory.getLogger('t.T');
      logger.trace('dropped at DEBUG');
      expect(lines).toHaveLength(0);
      setRootLevel(Level.TRACE);
      logger.trace('kept at {}', 'TRACE');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('TRACE t.T - kept at TRACE');
    } finally {
      setRootLevel(Level.DEBUG);
      resetAppender();
    }
  });

  test('the default appender writes the line to stdout, as logback does', () => {
    // resetAppender() reinstates it; capture what it hands to process.stdout.
    resetAppender();
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    try {
      LoggerFactory.getLogger('d.D').info('to stdout');
    } finally {
      process.stdout.write = original;
    }
    expect(written.some((line) => line.includes('INFO  d.D - to stdout\n'))).toBe(true);
  });
});

describe('CachedUidGenerator, the rest of its configuration surface', () => {
  test('setPaddingFactor changes the ring threshold', async () => {
    const generator = new CachedUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setPaddingFactor(25);
    generator.setWorkerIdAssigner(fixedAssigner(5n));
    setRootLevel(Level.ERROR);
    try {
      await generator.afterPropertiesSet();
      // bufferSize 65536 at 25% -> threshold 16384, not the default 32768.
      expect(generator.getRingBuffer().toString())
        .toBe('RingBuffer [bufferSize=65536, tail=65535, cursor=-1, paddingThreshold=16384]');
      expect(generator.getBufferPaddingExecutor().isRunning()).toBe(false);
    } finally {
      await generator.destroy();
      setRootLevel(Level.DEBUG);
    }
  });

  test('getBufferPaddingExecutor hands back the executor wired into the ring', async () => {
    const generator = new CachedUidGenerator();
    generator.setTimeBits(29);
    generator.setWorkerBits(21);
    generator.setSeqBits(13);
    generator.setEpochStr('2016-09-20');
    generator.setWorkerIdAssigner(fixedAssigner(6n));
    setRootLevel(Level.ERROR);
    try {
      await generator.afterPropertiesSet();
      const executor = generator.getBufferPaddingExecutor();
      const ring = generator.getRingBuffer();
      const tailBefore = ring.getTail();
      executor.paddingBuffer();
      // The ring was already full, so the pass finds nothing to add.
      expect(ring.getTail()).toBe(tailBefore);
      await generator.destroy();
      // After shutdown the pool rejects further work, as ExecutorService does.
      expect(() => { executor.asyncPadding(); }).toThrow();
    } finally {
      setRootLevel(Level.DEBUG);
    }
  });
});

describe('openMysqlSqlSession', () => {
  test('maps mysql.properties onto the driver connection settings', () => {
    const properties = new Map([
      ['jdbc.url', 'jdbc:mysql://db.internal:3307/uid?useUnicode=true'],
      ['jdbc.username', 'root'],
      ['jdbc.password', 'secret'],
    ]);
    expect(mysqlConnectionOptions(properties)).toEqual({
      host: 'db.internal',
      port: 3307,
      database: 'uid',
      user: 'root',
      password: 'secret',
      dateStrings: ['DATE'],
    });
  });

  test('opens a session over whatever the connector returns', async () => {
    const seen: MysqlConnectionOptions[] = [];
    const connection: MysqlConnection = {
      query: () => Promise.resolve([{ insertId: 3 }, null]),
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
      end: () => Promise.resolve(),
    };
    const session = await openMysqlSqlSession(
      new Map([
        ['jdbc.url', 'jdbc:mysql://localhost/uid'],
        ['jdbc.username', 'u'],
        ['jdbc.password', 'p'],
      ]),
      (options) => {
        seen.push(options);
        return Promise.resolve(connection);
      },
    );
    expect(seen[0]?.port).toBe(3306);
    expect(session.dialect).toBe(MYSQL_DIALECT);
    expect((await session.insert('INSERT', [])).generatedKey).toBe(3n);
    await session.close();
  });

  test('the default connector reaches the real driver, and its failures propagate', async () => {
    // No connector argument, so this goes through mysql2 itself. Port 1 refuses
    // immediately, which is the cheapest way to prove the wiring is live
    // without standing a server up.
    await expect(openMysqlSqlSession(new Map([
      ['jdbc.url', 'jdbc:mysql://127.0.0.1:1/uid'],
      ['jdbc.username', 'u'],
      ['jdbc.password', 'p'],
    ]))).rejects.toThrow(/ECONNREFUSED|connect/i);
  });

  test('an unusable jdbc.url fails before any connection is attempted', async () => {
    let attempted = false;
    await expect(openMysqlSqlSession(
      new Map([['jdbc.url', 'jdbc:oracle:thin:@db'], ['jdbc.username', 'u'], ['jdbc.password', 'p']]),
      () => { attempted = true; throw new Error('should not be reached'); },
    )).rejects.toThrow('Unsupported JDBC url');
    expect(attempted).toBe(false);
  });
});

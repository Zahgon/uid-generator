/*
 * Port of `src/test/java/com/baidu/fsg/uid/CachedUidGeneratorTest.java`.
 *
 * Java's `@RunWith(SpringJUnit4ClassRunner.class)` +
 * `@ContextConfiguration("classpath:uid/cached-uid-spring.xml")` becomes the
 * fixture factory in `test/resources/uid/cached-uid-spring.ts`.
 */

import { availableParallelism } from 'node:os';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { StringUtils } from '../src/deps/commons-lang/string-utils.js';
import { AtomicInteger } from '../src/deps/java/atomic.js';
import { Thread } from '../src/deps/java/thread.js';
import type { UidGenerator } from '../src/uid-generator.js';
import type { CachedUidGeneratorContext } from './resources/uid/cached-uid-spring.js';
import { createCachedUidGeneratorContext } from './resources/uid/cached-uid-spring.js';

/**
 * Test for `CachedUidGenerator`
 *
 * @author yutianbao
 */
describe('CachedUidGeneratorTest', () => {
  const SIZE = 7000000; // 700w
  const VERBOSE: boolean = false;
  const THREADS = availableParallelism() << 1;

  let context: CachedUidGeneratorContext;
  let uidGenerator: UidGenerator;

  beforeAll(async () => {
    context = await createCachedUidGeneratorContext();
    uidGenerator = context.uidGenerator;
  });

  afterAll(async () => {
    await context.close();
  });

  /**
   * Do generating
   */
  function doGenerate(uidSet: Set<bigint>, index: number): void {
    const uid = uidGenerator.getUID();
    const parsedInfo = uidGenerator.parseUID(uid);
    const existed = uidSet.has(uid);
    uidSet.add(uid);
    if (existed) {
      process.stdout.write(`Found duplicate UID ${uid.toString()}\n`);
    }

    // Check UID is positive, and can be parsed
    expect(uid > 0n).toBe(true);
    expect(StringUtils.isNotBlank(parsedInfo)).toBe(true);

    if (VERBOSE) {
      process.stdout.write(
        `${Thread.currentThread().getName()} No.${String(index)} >>> ${parsedInfo}\n`,
      );
    }
  }

  /**
   * Woker run
   */
  async function workerRun(uidSet: Set<bigint>, control: AtomicInteger): Promise<void> {
    for (;;) {
      const myPosition = control.updateAndGet((old) => (old === SIZE ? SIZE : old + 1));
      if (myPosition === SIZE) {
        return;
      }

      doGenerate(uidSet, myPosition);
      // Yield so the other workers make progress: Node interleaves tasks at
      // their suspension points, where the JVM preempts threads.
      await Promise.resolve();
    }
  }

  /**
   * Check UIDs are all unique
   */
  function checkUniqueID(uidSet: Set<bigint>): void {
    process.stdout.write(`${String(uidSet.size)}\n`);
    expect(uidSet.size).toBe(SIZE);
  }

  /**
   * Test for serially generate
   */
  test('testSerialGenerate', () => {
    // Generate UID serially
    const uidSet = new Set<bigint>();
    for (let i = 0; i < SIZE; i += 1) {
      doGenerate(uidSet, i);
    }

    // Check UIDs are all unique
    checkUniqueID(uidSet);
  });

  /**
   * Test for parallel generate
   */
  test('testParallelGenerate', async () => {
    const control = new AtomicInteger(-1);
    const uidSet = new Set<bigint>();

    // Initialize threads
    const threadList: Thread[] = [];
    for (let i = 0; i < THREADS; i += 1) {
      const thread = new Thread(() => workerRun(uidSet, control));
      thread.setName(`UID-generator-${String(i)}`);

      threadList.push(thread);
      thread.start();
    }

    // Wait for worker done
    for (const thread of threadList) {
      await thread.join();
    }

    // Check generate 700w times
    expect(control.get()).toBe(SIZE);

    // Check UIDs are all unique
    checkUniqueID(uidSet);
  });
});

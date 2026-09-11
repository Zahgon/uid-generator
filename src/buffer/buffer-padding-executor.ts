/*
 * Copyright (c) 2017 Baidu, Inc. All Rights Reserve.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { availableParallelism } from 'node:os';
import { AtomicBoolean } from '../deps/java/atomic.js';
import { Executors } from '../deps/java/executors.js';
import type { ExecutorService, ScheduledExecutorService } from '../deps/java/executors.js';
import { TimeUnit } from '../deps/java/time-unit.js';
import { Assert } from '../deps/spring/assert.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';
import { NamingThreadFactory } from '../utils/naming-thread-factory.js';
import { PaddedAtomicLong } from '../utils/padded-atomic-long.js';
import type { BufferedUidProvider } from './buffered-uid-provider.js';
import type { RingBuffer } from './ring-buffer.js';

/**
 * Represents an executor for padding `RingBuffer`
 * There are two kinds of executors: one for scheduled padding, the other for padding immediately.
 *
 * @author yutianbao
 */
// Upstream deliberately logs under RingBuffer's name, not this class's.
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.buffer.RingBuffer');

/** Constants */
const WORKER_NAME = 'RingBuffer-Padding-Worker';
const SCHEDULE_NAME = 'RingBuffer-Padding-Schedule';
const DEFAULT_SCHEDULE_INTERVAL = 5 * 60; // 5 minutes

export class BufferPaddingExecutor {
  /** Whether buffer padding is running */
  private readonly running: AtomicBoolean;

  /** We can borrow UIDs from the future, here store the last second we have consumed */
  private readonly lastSecond: PaddedAtomicLong;

  /** RingBuffer & BufferUidProvider */
  private readonly ringBuffer: RingBuffer;
  private readonly uidProvider: BufferedUidProvider;

  /** Padding immediately by the thread pool */
  private readonly bufferPadExecutors: ExecutorService;
  /** Padding schedule thread */
  private readonly bufferPadSchedule: ScheduledExecutorService | null;

  /** Schedule interval Unit as seconds */
  private scheduleInterval: number = DEFAULT_SCHEDULE_INTERVAL;

  /**
   * Constructor with `RingBuffer`, `BufferedUidProvider`, and whether use schedule padding
   */
  constructor(ringBuffer: RingBuffer, uidProvider: BufferedUidProvider, usingSchedule = true) {
    this.running = new AtomicBoolean(false);
    this.lastSecond = new PaddedAtomicLong(TimeUnit.MILLISECONDS.toSeconds(BigInt(Date.now())));
    this.ringBuffer = ringBuffer;
    this.uidProvider = uidProvider;

    // initialize thread pool
    const cores = availableParallelism();
    this.bufferPadExecutors = Executors.newFixedThreadPool(
      cores * 2,
      new NamingThreadFactory(WORKER_NAME),
    );

    // initialize schedule thread
    if (usingSchedule) {
      this.bufferPadSchedule = Executors.newSingleThreadScheduledExecutor(
        new NamingThreadFactory(SCHEDULE_NAME),
      );
    } else {
      this.bufferPadSchedule = null;
    }
  }

  /**
   * Start executors such as schedule
   */
  start(): void {
    if (this.bufferPadSchedule !== null) {
      this.bufferPadSchedule.scheduleWithFixedDelay(
        () => {
          this.paddingBuffer();
        },
        this.scheduleInterval,
        this.scheduleInterval,
      );
    }
  }

  /**
   * Shutdown executors
   */
  shutdown(): void {
    if (!this.bufferPadExecutors.isShutdown()) {
      this.bufferPadExecutors.shutdownNow();
    }

    if (this.bufferPadSchedule !== null && !this.bufferPadSchedule.isShutdown()) {
      this.bufferPadSchedule.shutdownNow();
    }
  }

  /**
   * Whether is padding
   */
  isRunning(): boolean {
    return this.running.get();
  }

  /**
   * Padding buffer in the thread pool
   */
  asyncPadding(): void {
    this.bufferPadExecutors.submit(() => {
      this.paddingBuffer();
    });
  }

  /**
   * Padding buffer fill the slots until to catch the cursor
   */
  paddingBuffer(): void {
    LOGGER.info('Ready to padding buffer lastSecond:{}. {}', this.lastSecond.get(), this.ringBuffer);

    // is still running
    if (!this.running.compareAndSet(false, true)) {
      LOGGER.info('Padding buffer is still running. {}', this.ringBuffer);
      return;
    }

    // fill the rest slots until to catch the cursor
    let isFullRingBuffer = false;
    while (!isFullRingBuffer) {
      const uidList = this.uidProvider(this.lastSecond.incrementAndGet());
      for (const uid of uidList) {
        isFullRingBuffer = !this.ringBuffer.put(uid);
        if (isFullRingBuffer) {
          break;
        }
      }
    }

    // not running now
    this.running.compareAndSet(true, false);
    LOGGER.info('End to padding buffer lastSecond:{}. {}', this.lastSecond.get(), this.ringBuffer);
  }

  /**
   * Setters
   */
  setScheduleInterval(scheduleInterval: number): void {
    Assert.isTrue(scheduleInterval > 0, 'Schedule interval must positive!');
    this.scheduleInterval = scheduleInterval;
  }
}

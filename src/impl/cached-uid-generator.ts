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

import { BufferPaddingExecutor } from '../buffer/buffer-padding-executor.js';
import { RingBuffer } from '../buffer/ring-buffer.js';
import type { RejectedPutBufferHandler } from '../buffer/rejected-put-buffer-handler.js';
import type { RejectedTakeBufferHandler } from '../buffer/rejected-take-buffer-handler.js';
import { add, subtract } from '../deps/java/long.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';
import type { DisposableBean } from '../deps/spring/lifecycle.js';
import { Assert } from '../deps/spring/assert.js';
import { UidGenerateException } from '../exception/uid-generate-exception.js';
import { DefaultUidGenerator } from './default-uid-generator.js';

/**
 * Represents a cached implementation of `UidGenerator` extends
 * from `DefaultUidGenerator`, based on a lock free `RingBuffer`
 *
 * The properties you can specified as below:
 * - **boostPower:** RingBuffer size boost for a power of 2, Sample: boostPower is 3, it means the buffer size
 *                   will be `(BitsAllocator.getMaxSequence() + 1) << boostPower`, Default as 3
 * - **paddingFactor:** Represents a percent value of (0 - 100). When the count of rest available UIDs reach the
 *                      threshold, it will trigger padding buffer. Default as `RingBuffer.DEFAULT_PADDING_PERCENT`
 *                      Sample: paddingFactor=20, bufferSize=1000 -> threshold=1000 * 20 /100, padding buffer will
 *                      be triggered when tail-cursor&lt;threshold
 * - **scheduleInterval:** Padding buffer in a schedule, specify padding buffer interval, Unit as second
 * - **rejectedPutBufferHandler:** Policy for rejected put buffer. Default as discard put request, just do logging
 * - **rejectedTakeBufferHandler:** Policy for rejected take buffer. Default as throwing up an exception
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.impl.CachedUidGenerator');
const DEFAULT_BOOST_POWER = 3;

export class CachedUidGenerator extends DefaultUidGenerator implements DisposableBean {
  /** Configured properties */
  private boostPower: number = DEFAULT_BOOST_POWER;
  private paddingFactor: number = RingBuffer.DEFAULT_PADDING_PERCENT;
  private scheduleInterval: number | null = null;

  private rejectedPutBufferHandler: RejectedPutBufferHandler | null = null;
  private rejectedTakeBufferHandler: RejectedTakeBufferHandler | null = null;

  /** RingBuffer */
  private ringBuffer!: RingBuffer;
  private bufferPaddingExecutor!: BufferPaddingExecutor;

  override async afterPropertiesSet(): Promise<void> {
    // initialize workerId & bitsAllocator
    await super.afterPropertiesSet();

    // initialize RingBuffer & RingBufferPaddingExecutor
    this.initRingBuffer();
    LOGGER.info('Initialized RingBuffer successfully.');
  }

  override getUID(): bigint {
    try {
      return this.ringBuffer.take();
    } catch (e) {
      LOGGER.error('Generate unique id exception. ', e);
      throw new UidGenerateException(e);
    }
  }

  override parseUID(uid: bigint): string {
    return super.parseUID(uid);
  }

  destroy(): Promise<void> {
    this.bufferPaddingExecutor.shutdown();
    return Promise.resolve();
  }

  /**
   * Get the UIDs in the same specified second under the max sequence
   *
   * @returns UID list, size of `BitsAllocator.getMaxSequence()` + 1
   */
  protected nextIdsForOneSecond(currentSecond: bigint): bigint[] {
    // Initialize result list size of (max sequence + 1)
    const listSize = Number(this.bitsAllocator.getMaxSequence()) + 1;
    const uidList: bigint[] = new Array<bigint>(listSize);

    // Allocate the first sequence of the second, the others can be calculated with the offset
    const firstSeqUid = this.bitsAllocator.allocate(
      subtract(currentSecond, this.epochSeconds),
      this.workerId,
      0n,
    );
    for (let offset = 0; offset < listSize; offset += 1) {
      uidList[offset] = add(firstSeqUid, BigInt(offset));
    }

    return uidList;
  }

  /**
   * Initialize RingBuffer & RingBufferPaddingExecutor
   */
  private initRingBuffer(): void {
    // initialize RingBuffer
    const bufferSize = (Number(this.bitsAllocator.getMaxSequence()) + 1) << this.boostPower;
    this.ringBuffer = new RingBuffer(bufferSize, this.paddingFactor);
    LOGGER.info('Initialized ring buffer size:{}, paddingFactor:{}', bufferSize, this.paddingFactor);

    // initialize RingBufferPaddingExecutor
    const usingSchedule = this.scheduleInterval !== null;
    this.bufferPaddingExecutor = new BufferPaddingExecutor(
      this.ringBuffer,
      (momentInSecond) => this.nextIdsForOneSecond(momentInSecond),
      usingSchedule,
    );
    if (usingSchedule) {
      this.bufferPaddingExecutor.setScheduleInterval(this.scheduleInterval!);
    }

    LOGGER.info(
      'Initialized BufferPaddingExecutor. Using schdule:{}, interval:{}',
      usingSchedule,
      this.scheduleInterval,
    );

    // set rejected put/take handle policy
    this.ringBuffer.setBufferPaddingExecutor(this.bufferPaddingExecutor);
    if (this.rejectedPutBufferHandler !== null) {
      this.ringBuffer.setRejectedPutHandler(this.rejectedPutBufferHandler);
    }
    if (this.rejectedTakeBufferHandler !== null) {
      this.ringBuffer.setRejectedTakeHandler(this.rejectedTakeBufferHandler);
    }

    // fill in all slots of the RingBuffer
    this.bufferPaddingExecutor.paddingBuffer();

    // start buffer padding threads
    this.bufferPaddingExecutor.start();
  }

  /**
   * Setters for configured property
   */
  setBoostPower(boostPower: number): void {
    Assert.isTrue(boostPower > 0, 'Boost power must be positive!');
    this.boostPower = boostPower;
  }

  setRejectedPutBufferHandler(rejectedPutBufferHandler: RejectedPutBufferHandler): void {
    Assert.notNull(rejectedPutBufferHandler, "RejectedPutBufferHandler can't be null!");
    this.rejectedPutBufferHandler = rejectedPutBufferHandler;
  }

  setRejectedTakeBufferHandler(rejectedTakeBufferHandler: RejectedTakeBufferHandler): void {
    Assert.notNull(rejectedTakeBufferHandler, "RejectedTakeBufferHandler can't be null!");
    this.rejectedTakeBufferHandler = rejectedTakeBufferHandler;
  }

  setPaddingFactor(paddingFactor: number): void {
    this.paddingFactor = paddingFactor;
  }

  setScheduleInterval(scheduleInterval: number): void {
    Assert.isTrue(scheduleInterval > 0, 'Schedule interval must positive!');
    this.scheduleInterval = scheduleInterval;
  }

  /** Exposed for the ring-buffer tests, as the Java field is package-visible through Spring. */
  getRingBuffer(): RingBuffer {
    return this.ringBuffer;
  }

  getBufferPaddingExecutor(): BufferPaddingExecutor {
    return this.bufferPaddingExecutor;
  }
}

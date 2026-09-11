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

import { AtomicLong } from '../deps/java/atomic.js';
import { bitCount } from '../deps/java/long.js';
import { Assert } from '../deps/spring/assert.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';
import { PaddedAtomicLong } from '../utils/padded-atomic-long.js';
import type { BufferPaddingExecutor } from './buffer-padding-executor.js';
import type { RejectedPutBufferHandler } from './rejected-put-buffer-handler.js';
import type { RejectedTakeBufferHandler } from './rejected-take-buffer-handler.js';

/**
 * Represents a ring buffer based on array.
 * Using array could improve read element performance due to the CUP cache line. To prevent
 * the side effect of False Sharing, `PaddedAtomicLong` is using on 'tail' and 'cursor'
 *
 * A ring buffer is consisted of:
 * - **slots:** each element of the array is a slot, which is be set with a UID
 * - **flags:** flag array corresponding the same index with the slots, indicates whether can take or put slot
 * - **tail:** a sequence of the max slot position to produce
 * - **cursor:** a sequence of the min slot position to consume
 *
 * `put` is `synchronized` upstream and `take` relies on an atomic cursor. Node
 * runs one JavaScript thread with no preemption inside a synchronous body, so
 * both methods are already indivisible with respect to every other caller; the
 * atomics are kept because the sequence arithmetic is 64-bit and because `tail`
 * and `cursor` are public through the getters.
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.buffer.RingBuffer');

/** Constants */
const START_POINT = -1n;
const CAN_PUT_FLAG = 0n;
const CAN_TAKE_FLAG = 1n;

export class RingBuffer {
  static readonly DEFAULT_PADDING_PERCENT = 50;

  /** The size of RingBuffer's slots, each slot hold a UID */
  private readonly bufferSize: number;
  private readonly indexMask: bigint;
  private readonly slots: BigInt64Array;
  private readonly flags: readonly PaddedAtomicLong[];

  /** Tail: last position sequence to produce */
  private readonly tail: AtomicLong = new PaddedAtomicLong(START_POINT);

  /** Cursor: current position sequence to consume */
  private readonly cursor: AtomicLong = new PaddedAtomicLong(START_POINT);

  /** Threshold for trigger padding buffer */
  private readonly paddingThreshold: number;

  /** Reject put/take buffer handle policy */
  private rejectedPutHandler: RejectedPutBufferHandler = (ringBuffer, uid) => {
    this.discardPutBuffer(ringBuffer, uid);
  };

  private rejectedTakeHandler: RejectedTakeBufferHandler = (ringBuffer) => {
    this.exceptionRejectedTakeBuffer(ringBuffer);
  };

  /** Executor of padding buffer */
  private bufferPaddingExecutor: BufferPaddingExecutor | null = null;

  /**
   * Constructor with buffer size & padding factor
   *
   * @param bufferSize must be positive & a power of 2
   * @param paddingFactor percent in (0 - 100). When the count of rest available UIDs reach the threshold,
   *        it will trigger padding buffer.
   *        Sample: paddingFactor=20, bufferSize=1000 -> threshold=1000 * 20 /100,
   *        padding buffer will be triggered when tail-cursor&lt;threshold
   */
  constructor(bufferSize: number, paddingFactor: number = RingBuffer.DEFAULT_PADDING_PERCENT) {
    // check buffer size is positive & a power of 2; padding factor in (0, 100)
    Assert.isTrue(bufferSize > 0, 'RingBuffer size must be positive');
    Assert.isTrue(bitCount(bufferSize) === 1, 'RingBuffer size must be a power of 2');
    Assert.isTrue(paddingFactor > 0 && paddingFactor < 100, 'RingBuffer size must be positive');

    this.bufferSize = bufferSize;
    this.indexMask = BigInt(bufferSize - 1);
    this.slots = new BigInt64Array(bufferSize);
    this.flags = RingBuffer.initFlags(bufferSize);

    this.paddingThreshold = Math.trunc((bufferSize * paddingFactor) / 100);
  }

  /**
   * Put an UID in the ring & tail moved
   *
   * **Note that:** It is recommended to put UID in a serialize way, cause we once batch generate a series
   * UIDs and put the one by one into the buffer, so it is unnecessary put in multi-threads
   *
   * @returns false means that the buffer is full, apply `RejectedPutBufferHandler`
   */
  put(uid: bigint): boolean {
    const currentTail = this.tail.get();
    const currentCursor = this.cursor.get();

    // tail catches the cursor, means that you can't put any cause of RingBuffer is full
    const distance = currentTail - (currentCursor === START_POINT ? 0n : currentCursor);
    if (distance === BigInt(this.bufferSize - 1)) {
      this.rejectedPutHandler(this, uid);
      return false;
    }

    // 1. pre-check whether the flag is CAN_PUT_FLAG
    const nextTailIndex = this.calSlotIndex(currentTail + 1n);
    if (this.flags[nextTailIndex]!.get() !== CAN_PUT_FLAG) {
      this.rejectedPutHandler(this, uid);
      return false;
    }

    // 2. put UID in the next slot
    // 3. update next slot' flag to CAN_TAKE_FLAG
    // 4. publish tail with sequence increase by one
    this.slots[nextTailIndex] = uid;
    this.flags[nextTailIndex]!.set(CAN_TAKE_FLAG);
    this.tail.incrementAndGet();

    return true;
  }

  /**
   * Take an UID of the ring at the next cursor, this is a lock free operation by using atomic cursor
   *
   * Before getting the UID, we also check whether reach the padding threshold,
   * the padding buffer operation will be triggered off the caller's critical path.
   * If there is no more available UID to be taken, the specified `RejectedTakeBufferHandler` will be applied
   *
   * @returns UID
   */
  take(): bigint {
    // spin get next available cursor
    const currentCursor = this.cursor.get();
    const nextCursor = this.cursor.updateAndGet((old) => (old === this.tail.get() ? old : old + 1n));

    // check for safety consideration, it never occurs
    Assert.isTrue(nextCursor >= currentCursor, "Curosr can't move back");

    // trigger padding if reach the threshold
    const currentTail = this.tail.get();
    if (currentTail - nextCursor < BigInt(this.paddingThreshold)) {
      LOGGER.info(
        'Reach the padding threshold:{}. tail:{}, cursor:{}, rest:{}',
        this.paddingThreshold,
        currentTail,
        nextCursor,
        currentTail - nextCursor,
      );
      this.bufferPaddingExecutor?.asyncPadding();
    }

    // cursor catch the tail, means that there is no more available UID to take
    if (nextCursor === currentCursor) {
      this.rejectedTakeHandler(this);
    }

    // 1. check next slot flag is CAN_TAKE_FLAG
    const nextCursorIndex = this.calSlotIndex(nextCursor);
    Assert.isTrue(this.flags[nextCursorIndex]!.get() === CAN_TAKE_FLAG, 'Curosr not in can take status');

    // 2. get UID from next slot
    // 3. set next slot flag as CAN_PUT_FLAG.
    const uid = this.slots[nextCursorIndex]!;
    this.flags[nextCursorIndex]!.set(CAN_PUT_FLAG);

    // Note that: Step 2,3 can not swap. If we set flag before get value of slot, the producer may overwrite the
    // slot with a new UID, and this may cause the consumer take the UID twice after walk a round the ring
    return uid;
  }

  /**
   * Calculate slot index with the slot sequence (sequence % bufferSize)
   */
  protected calSlotIndex(sequence: bigint): number {
    return Number(sequence & this.indexMask);
  }

  /**
   * Discard policy for `RejectedPutBufferHandler`, we just do logging
   */
  protected discardPutBuffer(ringBuffer: RingBuffer, uid: bigint): void {
    LOGGER.warn('Rejected putting buffer for uid:{}. {}', uid, ringBuffer);
  }

  /**
   * Policy for `RejectedTakeBufferHandler`, throws an error after logging
   */
  protected exceptionRejectedTakeBuffer(ringBuffer: RingBuffer): void {
    LOGGER.warn('Rejected take buffer. {}', ringBuffer);
    throw new Error(`Rejected take buffer. ${ringBuffer.toString()}`);
  }

  /**
   * Initialize flags as CAN_PUT_FLAG
   */
  private static initFlags(bufferSize: number): readonly PaddedAtomicLong[] {
    const flags: PaddedAtomicLong[] = new Array<PaddedAtomicLong>(bufferSize);
    for (let i = 0; i < bufferSize; i += 1) {
      flags[i] = new PaddedAtomicLong(CAN_PUT_FLAG);
    }

    return flags;
  }

  /**
   * Getters
   */
  getTail(): bigint {
    return this.tail.get();
  }

  getCursor(): bigint {
    return this.cursor.get();
  }

  getBufferSize(): number {
    return this.bufferSize;
  }

  /**
   * Setters
   */
  setBufferPaddingExecutor(bufferPaddingExecutor: BufferPaddingExecutor): void {
    this.bufferPaddingExecutor = bufferPaddingExecutor;
  }

  setRejectedPutHandler(rejectedPutHandler: RejectedPutBufferHandler): void {
    this.rejectedPutHandler = rejectedPutHandler;
  }

  setRejectedTakeHandler(rejectedTakeHandler: RejectedTakeBufferHandler): void {
    this.rejectedTakeHandler = rejectedTakeHandler;
  }

  toString(): string {
    return `RingBuffer [bufferSize=${String(this.bufferSize)}`
      + `, tail=${this.tail.toString()}`
      + `, cursor=${this.cursor.toString()}`
      + `, paddingThreshold=${String(this.paddingThreshold)}]`;
  }
}

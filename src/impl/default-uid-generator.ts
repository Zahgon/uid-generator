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

import { BitsAllocator } from '../bits-allocator.js';
import { StringUtils } from '../deps/commons-lang/string-utils.js';
import { and, shiftLeft, subtract, unsignedShiftRight } from '../deps/java/long.js';
import { format } from '../deps/java/string-format.js';
import { TimeUnit } from '../deps/java/time-unit.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';
import type { InitializingBean } from '../deps/spring/lifecycle.js';
import { UidGenerateException } from '../exception/uid-generate-exception.js';
import type { UidGenerator } from '../uid-generator.js';
import { DateUtils } from '../utils/date-utils.js';
import type { WorkerIdAssigner } from '../worker/worker-id-assigner.js';

/**
 * Represents an implementation of `UidGenerator`
 *
 * The unique id has 64bits (long), default allocated as blow:
 * - sign: The highest bit is 0
 * - delta seconds: The next 28 bits, represents delta seconds since a customer epoch(2016-05-20 00:00:00.000).
 *                  Supports about 8.7 years until to 2024-11-20 21:24:16
 * - worker id: The next 22 bits, represents the worker's id which assigns based on database, max id is about 420W
 * - sequence: The next 13 bits, represents a sequence within the same second, max for 8192/s
 *
 * `DefaultUidGenerator.parseUID(uid)` is a tool method to parse the bits
 *
 * ```
 * +------+----------------------+----------------+-----------+
 * | sign |     delta seconds    | worker node id | sequence  |
 * +------+----------------------+----------------+-----------+
 *   1bit          28bits              22bits         13bits
 * ```
 *
 * You can also specified the bits by property setting.
 * - timeBits: default as 28
 * - workerBits: default as 22
 * - seqBits: default as 13
 * - epochStr: Epoch date string format 'yyyy-MM-dd'. Default as '2016-05-20'
 *
 * **Note that:** The total bits must be 64 -1
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.impl.DefaultUidGenerator');

export class DefaultUidGenerator implements UidGenerator, InitializingBean {
  /** Bits allocate */
  protected timeBits = 28;
  protected workerBits = 22;
  protected seqBits = 13;

  /** Customer epoch, unit as second. For example 2016-05-20 (ms: 1463673600000) */
  protected epochStr = '2016-05-20';
  protected epochSeconds: bigint = TimeUnit.MILLISECONDS.toSeconds(1463673600000n);

  /** Stable fields after bean initializing */
  protected bitsAllocator!: BitsAllocator;
  protected workerId = 0n;

  /** Volatile fields caused by nextId() */
  protected sequence = 0n;
  protected lastSecond = -1n;

  /** Configured property */
  protected workerIdAssigner!: WorkerIdAssigner;

  async afterPropertiesSet(): Promise<void> {
    // initialize bits allocator
    this.bitsAllocator = new BitsAllocator(this.timeBits, this.workerBits, this.seqBits);

    // initialize worker id
    this.workerId = await this.workerIdAssigner.assignWorkerId();
    if (this.workerId > this.bitsAllocator.getMaxWorkerId()) {
      throw new Error(
        `Worker id ${this.workerId.toString()} exceeds the max `
        + this.bitsAllocator.getMaxWorkerId().toString(),
      );
    }

    LOGGER.info(
      'Initialized bits(1, {}, {}, {}) for workerID:{}',
      this.timeBits,
      this.workerBits,
      this.seqBits,
      this.workerId,
    );
  }

  getUID(): bigint {
    try {
      return this.nextId();
    } catch (e) {
      LOGGER.error('Generate unique id exception. ', e);
      throw new UidGenerateException(e);
    }
  }

  parseUID(uid: bigint): string {
    const totalBits = BitsAllocator.TOTAL_BITS;
    const signBits = this.bitsAllocator.getSignBits();
    const timestampBits = this.bitsAllocator.getTimestampBits();
    const workerIdBits = this.bitsAllocator.getWorkerIdBits();
    const sequenceBits = this.bitsAllocator.getSequenceBits();

    // parse UID
    const sequence = unsignedShiftRight(shiftLeft(uid, totalBits - sequenceBits), totalBits - sequenceBits);
    const workerId = unsignedShiftRight(shiftLeft(uid, timestampBits + signBits), totalBits - workerIdBits);
    const deltaSeconds = unsignedShiftRight(uid, workerIdBits + sequenceBits);

    const thatTime = new Date(Number(TimeUnit.SECONDS.toMillis(this.epochSeconds + deltaSeconds)));
    const thatTimeStr = DateUtils.formatByDateTimePattern(thatTime);

    // format as string
    return format(
      '{"UID":"%d","timestamp":"%s","workerId":"%d","sequence":"%d"}',
      uid,
      thatTimeStr,
      workerId,
      sequence,
    );
  }

  /**
   * Get UID
   *
   * @throws UidGenerateException in the case: Clock moved backwards; Exceeds the max timestamp
   */
  protected nextId(): bigint {
    let currentSecond = this.getCurrentSecond();

    // Clock moved backwards, refuse to generate uid
    if (currentSecond < this.lastSecond) {
      const refusedSeconds = this.lastSecond - currentSecond;
      throw new UidGenerateException('Clock moved backwards. Refusing for %d seconds', refusedSeconds);
    }

    // At the same second, increase sequence
    if (currentSecond === this.lastSecond) {
      this.sequence = and(this.sequence + 1n, this.bitsAllocator.getMaxSequence());
      // Exceed the max sequence, we wait the next second to generate uid
      if (this.sequence === 0n) {
        currentSecond = this.getNextSecond(this.lastSecond);
      }

      // At the different second, sequence restart from zero
    } else {
      this.sequence = 0n;
    }

    this.lastSecond = currentSecond;

    // Allocate bits for UID
    return this.bitsAllocator.allocate(
      subtract(currentSecond, this.epochSeconds),
      this.workerId,
      this.sequence,
    );
  }

  /**
   * Get next second
   */
  private getNextSecond(lastTimestamp: bigint): bigint {
    let timestamp = this.getCurrentSecond();
    while (timestamp <= lastTimestamp) {
      timestamp = this.getCurrentSecond();
    }

    return timestamp;
  }

  /**
   * Get current second
   */
  private getCurrentSecond(): bigint {
    const currentSecond = TimeUnit.MILLISECONDS.toSeconds(BigInt(Date.now()));
    if (currentSecond - this.epochSeconds > this.bitsAllocator.getMaxDeltaSeconds()) {
      throw new UidGenerateException(
        `Timestamp bits is exhausted. Refusing UID generate. Now: ${currentSecond.toString()}`,
      );
    }

    return currentSecond;
  }

  /**
   * Setters for configured property
   */
  setWorkerIdAssigner(workerIdAssigner: WorkerIdAssigner): void {
    this.workerIdAssigner = workerIdAssigner;
  }

  setTimeBits(timeBits: number): void {
    if (timeBits > 0) {
      this.timeBits = timeBits;
    }
  }

  setWorkerBits(workerBits: number): void {
    if (workerBits > 0) {
      this.workerBits = workerBits;
    }
  }

  setSeqBits(seqBits: number): void {
    if (seqBits > 0) {
      this.seqBits = seqBits;
    }
  }

  setEpochStr(epochStr: string): void {
    if (StringUtils.isNotBlank(epochStr)) {
      this.epochStr = epochStr;
      this.epochSeconds = TimeUnit.MILLISECONDS.toSeconds(
        BigInt(DateUtils.parseByDayPattern(epochStr).getTime()),
      );
    }
  }
}

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

import { ToStringBuilder, SHORT_PREFIX_STYLE } from './deps/commons-lang/to-string-builder.js';
import { Assert } from './deps/spring/assert.js';
import { not, or, shiftLeft } from './deps/java/long.js';

/**
 * Allocate 64 bits for the UID(long)
 * sign (fixed 1bit) -> deltaSecond -> workerId -> sequence(within the same second)
 *
 * @author yutianbao
 */
export class BitsAllocator {
  /**
   * Total 64 bits
   */
  static readonly TOTAL_BITS = 1 << 6;

  /**
   * Bits for [sign-> second-> workId-> sequence]
   *
   * Declared in this order deliberately: `toString()` reflects over the fields
   * and prints them in declaration order.
   */
  private readonly signBits: number = 1;
  private readonly timestampBits: number;
  private readonly workerIdBits: number;
  private readonly sequenceBits: number;

  /**
   * Max value for workId & sequence
   */
  private readonly maxDeltaSeconds: bigint;
  private readonly maxWorkerId: bigint;
  private readonly maxSequence: bigint;

  /**
   * Shift for timestamp & workerId
   */
  private readonly timestampShift: number;
  private readonly workerIdShift: number;

  /**
   * Constructor with timestampBits, workerIdBits, sequenceBits
   * The highest bit used for sign, so 63 bits for timestampBits, workerIdBits, sequenceBits
   */
  constructor(timestampBits: number, workerIdBits: number, sequenceBits: number) {
    // make sure allocated 64 bits
    const allocateTotalBits = this.signBits + timestampBits + workerIdBits + sequenceBits;
    Assert.isTrue(allocateTotalBits === BitsAllocator.TOTAL_BITS, 'allocate not enough 64 bits');

    // initialize bits
    this.timestampBits = timestampBits;
    this.workerIdBits = workerIdBits;
    this.sequenceBits = sequenceBits;

    // initialize max value
    this.maxDeltaSeconds = not(shiftLeft(-1n, timestampBits));
    this.maxWorkerId = not(shiftLeft(-1n, workerIdBits));
    this.maxSequence = not(shiftLeft(-1n, sequenceBits));

    // initialize shift
    this.timestampShift = workerIdBits + sequenceBits;
    this.workerIdShift = sequenceBits;
  }

  /**
   * Allocate bits for UID according to delta seconds & workerId & sequence
   * Note that: The highest bit will always be 0 for sign
   *
   * Only "always" while `deltaSeconds` stays within `maxDeltaSeconds`: the
   * shift wraps like a Java `long`, so an expired epoch overflows into the sign
   * bit and yields a negative UID rather than raising.
   */
  allocate(deltaSeconds: bigint, workerId: bigint, sequence: bigint): bigint {
    return or(
      or(shiftLeft(deltaSeconds, this.timestampShift), shiftLeft(workerId, this.workerIdShift)),
      sequence,
    );
  }

  /**
   * Getters
   */
  getSignBits(): number {
    return this.signBits;
  }

  getTimestampBits(): number {
    return this.timestampBits;
  }

  getWorkerIdBits(): number {
    return this.workerIdBits;
  }

  getSequenceBits(): number {
    return this.sequenceBits;
  }

  getMaxDeltaSeconds(): bigint {
    return this.maxDeltaSeconds;
  }

  getMaxWorkerId(): bigint {
    return this.maxWorkerId;
  }

  getMaxSequence(): bigint {
    return this.maxSequence;
  }

  getTimestampShift(): number {
    return this.timestampShift;
  }

  getWorkerIdShift(): number {
    return this.workerIdShift;
  }

  toString(): string {
    return ToStringBuilder.reflectionToString(this, SHORT_PREFIX_STYLE);
  }
}

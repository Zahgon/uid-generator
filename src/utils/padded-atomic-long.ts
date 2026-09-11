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

/**
 * Represents a padded `AtomicLong` to prevent the FalseSharing problem
 *
 * The CPU cache line commonly be 64 bytes, here is a sample of cache line after padding:
 * 64 bytes = 8 bytes (object reference) + 6 * 8 bytes (padded long) + 8 bytes (a long value)
 *
 * The padding has no effect on a JavaScript engine, which gives no control over
 * object layout; the fields are kept because they are public API and because
 * `sumPaddingToPreventOptimization()` has an observable return value.
 *
 * @author yutianbao
 */
export class PaddedAtomicLong extends AtomicLong {
  static readonly serialVersionUID = -3415778863941386253n;

  /** Padded 6 long (48 bytes) */
  p1 = 0n;
  p2 = 0n;
  p3 = 0n;
  p4 = 0n;
  p5 = 0n;
  p6 = 7n;

  /**
   * To prevent GC optimizations for cleaning unused padded references
   */
  sumPaddingToPreventOptimization(): bigint {
    return this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6;
  }
}

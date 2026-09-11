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

import { Assert } from '../deps/spring/assert.js';
import type { EnumType, ValuedEnum } from './valued-enum.js';

/**
 * EnumUtils provides the operations for `ValuedEnum` such as Parse, value of...
 *
 * @author yutianbao
 */
export const EnumUtils = {
  /**
   * Parse the bounded value into ValuedEnum
   */
  parse<V, T extends ValuedEnum<V>>(
    clz: EnumType<T> | null | undefined,
    value: V | null | undefined,
  ): T | null {
    Assert.notNull(clz, 'clz can not be null');
    if (value === null || value === undefined) {
      return null;
    }

    for (const t of clz.values()) {
      if (value === t.value()) {
        return t;
      }
    }
    return null;
  },

  /**
   * Null-safe valueOf function
   */
  valueOf<T>(enumType: EnumType<T>, name: string | null | undefined): T | null {
    if (name === null || name === undefined) {
      return null;
    }

    return enumType.valueOf(name);
  },
} as const;

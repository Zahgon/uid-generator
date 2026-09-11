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

import type { EnumType, ValuedEnum } from '../utils/valued-enum.js';

/**
 * WorkerNodeType
 * - CONTAINER: Such as Docker
 * - ACTUAL: Actual machine
 *
 * @author yutianbao
 */
export class WorkerNodeType implements ValuedEnum<number> {
  static readonly CONTAINER = new WorkerNodeType('CONTAINER', 0, 1);
  static readonly ACTUAL = new WorkerNodeType('ACTUAL', 1, 2);

  /**
   * Lock type
   */
  private readonly type: number;

  private constructor(
    private readonly enumName: string,
    private readonly enumOrdinal: number,
    type: number,
  ) {
    this.type = type;
  }

  value(): number {
    return this.type;
  }

  name(): string {
    return this.enumName;
  }

  ordinal(): number {
    return this.enumOrdinal;
  }

  toString(): string {
    return this.enumName;
  }

  /** `Class.getEnumConstants()`, in declaration order. */
  static values(): readonly WorkerNodeType[] {
    return [WorkerNodeType.CONTAINER, WorkerNodeType.ACTUAL];
  }

  /** `Enum.valueOf(WorkerNodeType.class, name)`. */
  static valueOf(name: string): WorkerNodeType {
    const found = WorkerNodeType.values().find((constant) => constant.name() === name);
    if (found === undefined) {
      throw new Error(`No enum constant WorkerNodeType.${name}`);
    }
    return found;
  }
}

/** The enum's class object, as `EnumUtils` expects it. */
export const WorkerNodeTypeClass: EnumType<WorkerNodeType> = {
  name: 'WorkerNodeType',
  values: () => WorkerNodeType.values(),
  valueOf: (name: string) => WorkerNodeType.valueOf(name),
};

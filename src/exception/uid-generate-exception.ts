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

import { format } from '../deps/java/string-format.js';

/**
 * Render a value the way `java.lang.Throwable.toString()` does — `TypeName:
 * message` — because wrapping a cause adopts that string as the wrapper's own
 * message.
 */
export function throwableToString(error: unknown): string {
  if (error instanceof Error) {
    // Java distinguishes a null message from an empty one: `new RuntimeException()`
    // renders as `java.lang.RuntimeException` and `new RuntimeException("")` as
    // `java.lang.RuntimeException: `. In JavaScript both carry `message === ''`,
    // but only the explicit form defines `message` as an own property.
    const hasMessage = Object.prototype.hasOwnProperty.call(error, 'message');
    return hasMessage ? `${error.name}: ${error.message}` : error.name;
  }
  return String(error);
}

/**
 * UidGenerateException
 *
 * @author yutianbao
 */
/*
 * The five overloads below mirror the original's five constructors one for one.
 * They could be collapsed into a single rest signature, but then the shape a
 * caller is allowed to use would stop being visible; the migration keeps the
 * documented surface.
 */
/* eslint-disable @typescript-eslint/unified-signatures */
export class UidGenerateException extends Error {
  /**
   * Serial Version UID
   */
  static readonly serialVersionUID = -27048199131316992n;

  /**
   * Default constructor
   */
  constructor();
  /**
   * Constructor with message & cause
   */
  constructor(message: string, cause: Error);
  /**
   * Constructor with message
   */
  constructor(message: string);
  /**
   * Constructor with message format
   */
  constructor(msgFormat: string, ...args: unknown[]);
  /**
   * Constructor with cause
   */
  constructor(cause: unknown);
  constructor(...args: readonly unknown[]) {
    if (args.length === 0) {
      super();
    } else if (typeof args[0] !== 'string') {
      // Throwable(Throwable cause): the message becomes cause.toString().
      super(throwableToString(args[0]), { cause: args[0] });
    } else if (args.length === 2 && args[1] instanceof Error) {
      super(args[0], { cause: args[1] });
    } else if (args.length === 1) {
      super(args[0]);
    } else {
      super(format(args[0], ...args.slice(1)));
    }
    this.name = 'UidGenerateException';
  }
}
/* eslint-enable @typescript-eslint/unified-signatures */

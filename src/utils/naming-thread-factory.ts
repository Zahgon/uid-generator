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

import { ClassUtils } from '../deps/commons-lang/class-utils.js';
import { StringUtils } from '../deps/commons-lang/string-utils.js';
import { AtomicLong } from '../deps/java/atomic.js';
import { Thread } from '../deps/java/thread.js';
import type { Runnable, UncaughtExceptionHandler } from '../deps/java/thread.js';
import { LoggerFactory } from '../deps/slf4j/logger.js';

/**
 * Named thread in ThreadFactory. If there is no specified name for thread, it
 * will auto detect using the invoker classname instead.
 *
 * @author yutianbao
 */
const LOGGER = LoggerFactory.getLogger('com.baidu.fsg.uid.utils.NamingThreadFactory');

/** `java.util.concurrent.ThreadFactory`. */
export interface ThreadFactory {
  newThread(r: Runnable): Thread;
}

export class NamingThreadFactory implements ThreadFactory {
  /**
   * Thread name pre
   */
  private name: string | null;

  /**
   * Is daemon thread
   */
  private daemon: boolean;

  /**
   * UncaughtExceptionHandler
   */
  private uncaughtExceptionHandler: UncaughtExceptionHandler | null;

  /**
   * Sequences for multi thread name prefix
   */
  private readonly sequences: Map<string, AtomicLong>;

  /**
   * Constructors
   */
  constructor(
    name: string | null = null,
    daemon = false,
    handler: UncaughtExceptionHandler | null = null,
  ) {
    this.name = name;
    this.daemon = daemon;
    this.uncaughtExceptionHandler = handler;
    this.sequences = new Map<string, AtomicLong>();
  }

  newThread(r: Runnable): Thread {
    const thread = new Thread(r);
    thread.setDaemon(this.daemon);

    // If there is no specified name for thread, it will auto detect using the invoker classname instead.
    // Notice that auto detect may cause some performance overhead
    const prefix = StringUtils.isBlank(this.name) ? this.getInvoker(2) : this.name!;
    thread.setName(`${prefix}-${this.getSequence(prefix).toString()}`);

    // no specified uncaughtExceptionHandler, just do logging.
    if (this.uncaughtExceptionHandler !== null) {
      thread.setUncaughtExceptionHandler(this.uncaughtExceptionHandler);
    } else {
      thread.setUncaughtExceptionHandler((t, e) => {
        LOGGER.error(`unhandled exception in thread: ${t.getId().toString()}:${t.getName()}`, e);
      });
    }

    return thread;
  }

  /**
   * Get the method invoker's class name
   *
   * Java reads frame `depth` of a freshly created exception's stack trace;
   * `Error.stack` is the same information, and V8 spells a method frame
   * `at Class.method (file:line:col)`.
   */
  private getInvoker(depth: number): string {
    const stack = new Error().stack;
    const frames = (stack ?? '').split('\n').slice(1);
    // Frame 0 of the Java trace is getInvoker itself; the slice above already
    // dropped the "Error" header, so frame `depth` lines up.
    const frame = frames[depth];
    if (frame !== undefined) {
      const match = /^\s*at (?:new )?([^\s(]+)/.exec(frame);
      const qualified = match?.[1];
      if (qualified !== undefined) {
        const lastDot = qualified.lastIndexOf('.');
        if (lastDot === -1) {
          return ClassUtils.getShortClassName(qualified);
        }
        const owner = qualified.slice(0, lastDot);
        // V8 names a frame after its receiver's constructor. For a *static*
        // method the receiver is the class object, and V8 before v13 reports
        // that generically as `Function` rather than as the class — the one
        // case where it cannot supply what `StackTraceElement.getClassName()`
        // would. The method name is then the only identifying token left.
        if (owner === 'Function' || owner === 'Object') {
          return ClassUtils.getShortClassName(qualified.slice(lastDot + 1));
        }
        return ClassUtils.getShortClassName(owner);
      }
    }
    return this.constructor.name;
  }

  /**
   * Get sequence for different naming prefix
   */
  private getSequence(invoker: string): bigint {
    let r = this.sequences.get(invoker);
    if (r === undefined) {
      // Java settles a race here with putIfAbsent; on the single JavaScript
      // thread a check-then-set cannot be interleaved.
      r = new AtomicLong(0n);
      this.sequences.set(invoker, r);
    }

    return r.incrementAndGet();
  }

  /**
   * Getters & Setters
   */
  getName(): string | null {
    return this.name;
  }

  setName(name: string | null): void {
    this.name = name;
  }

  isDaemon(): boolean {
    return this.daemon;
  }

  setDaemon(daemon: boolean): void {
    this.daemon = daemon;
  }

  getUncaughtExceptionHandler(): UncaughtExceptionHandler | null {
    return this.uncaughtExceptionHandler;
  }

  setUncaughtExceptionHandler(handler: UncaughtExceptionHandler | null): void {
    this.uncaughtExceptionHandler = handler;
  }
}

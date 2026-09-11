/*
 * Reimplementation shim: the two `java.util.concurrent` executors
 * `BufferPaddingExecutor` builds.
 *
 * What the original gets from them is (a) fire-and-forget dispatch of a padding
 * pass off the consumer's critical path, (b) a fixed-delay schedule, (c) named
 * workers whose names reach the log through `%thread`, and (d) shutdown.
 *
 * Node supplies (b), (c) and (d) directly. It cannot supply (a): there is one
 * JavaScript thread, so a padding pass submitted while a consumer is spinning
 * in a synchronous loop would never get to run, and the ring would drain to
 * empty instead of being refilled. `ExecutorService.submit` therefore runs the
 * task on the caller's stack, under the pooled worker's name. The *values* the
 * ring is filled with are unchanged — the same provider is called for the same
 * seconds, in the same order, at the same trigger point — only the stack the
 * work happens on differs.
 */

import { Thread, runAsThread } from './thread.js';
import type { Runnable } from './thread.js';
import type { ThreadFactory } from '../../utils/naming-thread-factory.js';

/** Thrown where the JDK throws `java.util.concurrent.RejectedExecutionException`. */
export class RejectedExecutionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RejectedExecutionException';
  }
}

function reportUncaught(thread: Thread, error: unknown): void {
  const handler = thread.getUncaughtExceptionHandler();
  if (handler === null) {
    throw error;
  }
  handler(thread, error);
}

/** `java.util.concurrent.ExecutorService`, as `Executors.newFixedThreadPool` returns it. */
export class ExecutorService {
  private readonly poolSize: number;
  private readonly threadFactory: ThreadFactory;
  private readonly workers: Thread[] = [];
  private nextWorker = 0;
  private shutdown = false;

  constructor(poolSize: number, threadFactory: ThreadFactory) {
    this.poolSize = poolSize;
    this.threadFactory = threadFactory;
  }

  isShutdown(): boolean {
    return this.shutdown;
  }

  /**
   * `ExecutorService.submit(Runnable)`. A `ThreadPoolExecutor` grows to its core
   * size one worker per task before it starts reusing workers, so the first
   * `poolSize` submissions each mint a worker and later ones cycle through them.
   */
  submit(task: Runnable): void {
    if (this.shutdown) {
      throw new RejectedExecutionException('Task rejected from a shut down executor');
    }
    const worker = this.nextThread();
    runAsThread(worker, () => {
      try {
        const result = task();
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            reportUncaught(worker, error);
          });
        }
      } catch (error) {
        reportUncaught(worker, error);
      }
    });
  }

  /** `ExecutorService.shutdownNow()`: reject anything submitted afterwards. */
  shutdownNow(): void {
    this.shutdown = true;
  }

  private nextThread(): Thread {
    if (this.workers.length < this.poolSize) {
      // The factory names the worker; the body it is given is never started,
      // because the pool runs tasks on the caller's stack under this identity.
      const worker = this.threadFactory.newThread(() => undefined);
      this.workers.push(worker);
      return worker;
    }
    const worker = this.workers[this.nextWorker % this.poolSize]!;
    this.nextWorker = (this.nextWorker + 1) % this.poolSize;
    return worker;
  }
}

/**
 * `java.util.concurrent.ScheduledExecutorService`, as
 * `Executors.newSingleThreadScheduledExecutor` returns it, restricted to
 * `scheduleWithFixedDelay`.
 */
export class ScheduledExecutorService {
  private readonly threadFactory: ThreadFactory;
  private worker: Thread | null = null;
  private timer: NodeJS.Timeout | null = null;
  private shutdown = false;

  constructor(threadFactory: ThreadFactory) {
    this.threadFactory = threadFactory;
  }

  isShutdown(): boolean {
    return this.shutdown;
  }

  /**
   * `scheduleWithFixedDelay(command, initialDelay, delay, SECONDS)`: the next
   * run is scheduled `delay` after the previous one *finishes*.
   *
   * The timer is `unref`ed, because the scheduling thread is created through a
   * `NamingThreadFactory` whose daemon flag decides whether it keeps the JVM
   * alive — and a pending timer is what keeps a Node process alive.
   */
  scheduleWithFixedDelay(command: Runnable, initialDelaySeconds: number, delaySeconds: number): void {
    if (this.shutdown) {
      throw new RejectedExecutionException('Task rejected from a shut down executor');
    }
    this.worker ??= this.threadFactory.newThread(() => undefined);
    const worker = this.worker;

    const arm = (delay: number): void => {
      this.timer = setTimeout(() => {
        if (this.shutdown) {
          return;
        }
        runAsThread(worker, () => {
          try {
            const result = command();
            if (result instanceof Promise) {
              result.catch((error: unknown) => {
                reportUncaught(worker, error);
              });
            }
          } catch (error) {
            reportUncaught(worker, error);
          }
        });
        arm(delaySeconds * 1000);
      }, delay);
      this.timer.unref();
    };

    arm(initialDelaySeconds * 1000);
  }

  /** `ScheduledExecutorService.shutdownNow()`: cancel the schedule. */
  shutdownNow(): void {
    this.shutdown = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** `java.util.concurrent.Executors`. */
export const Executors = {
  newFixedThreadPool(nThreads: number, threadFactory: ThreadFactory): ExecutorService {
    return new ExecutorService(nThreads, threadFactory);
  },
  newSingleThreadScheduledExecutor(threadFactory: ThreadFactory): ScheduledExecutorService {
    return new ScheduledExecutorService(threadFactory);
  },
} as const;

/*
 * Reimplementation shim: `java.lang.Thread`, to the extent this component
 * observes one.
 *
 * The component never uses a thread for parallelism it could not get another
 * way — it uses one for *naming* (`NamingThreadFactory` labels every padding
 * worker, and those labels reach the log through `%thread`) and for
 * *fire-and-forget scheduling*. Node supplies both: `AsyncLocalStorage` is the
 * platform's thread-local, so a task's name follows it across `await`
 * boundaries exactly as a thread name follows a thread across blocking calls.
 *
 * What Node does not supply is preemption. A `Thread` here runs its body as an
 * asynchronous task on the one JavaScript thread: `start()` schedules it and
 * returns, `join()` awaits it, and tasks interleave at their suspension points
 * rather than at arbitrary instructions.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** `java.lang.Thread.UncaughtExceptionHandler`. */
export type UncaughtExceptionHandler = (thread: Thread, error: unknown) => void;

/** The body of a thread: `java.lang.Runnable`, possibly asynchronous. */
export type Runnable = () => void | Promise<void>;

const threadLocal = new AsyncLocalStorage<Thread>();

let nextThreadId = 1n;

export class Thread {
  private readonly id: bigint;
  private name: string;
  private daemon = false;
  private readonly runnable: Runnable | null;
  private uncaughtExceptionHandler: UncaughtExceptionHandler | null = null;
  private completion: Promise<void> | null = null;

  constructor(runnable: Runnable | null = null, name?: string) {
    this.id = nextThreadId;
    nextThreadId += 1n;
    this.name = name ?? `Thread-${(this.id - 1n).toString()}`;
    this.runnable = runnable;
  }

  /** `Thread.currentThread()`. */
  static currentThread(): Thread {
    return threadLocal.getStore() ?? MAIN_THREAD;
  }

  getId(): bigint {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  isDaemon(): boolean {
    return this.daemon;
  }

  setDaemon(daemon: boolean): void {
    this.daemon = daemon;
  }

  setUncaughtExceptionHandler(handler: UncaughtExceptionHandler | null): void {
    this.uncaughtExceptionHandler = handler;
  }

  getUncaughtExceptionHandler(): UncaughtExceptionHandler | null {
    return this.uncaughtExceptionHandler;
  }

  /**
   * `Thread.start()`: begin running the body and return immediately. An
   * exception escaping the body goes to the uncaught-exception handler, as it
   * does on a real thread, rather than becoming an unhandled rejection.
   */
  start(): void {
    if (this.completion !== null) {
      throw new Error('IllegalThreadStateException');
    }
    const runnable = this.runnable;
    this.completion = threadLocal.run(this, async () => {
      try {
        await runnable?.();
      } catch (error) {
        const handler = this.uncaughtExceptionHandler;
        if (handler === null) {
          throw error;
        }
        handler(this, error);
      }
    });
  }

  /** `Thread.join()`: wait for the body to finish. */
  async join(): Promise<void> {
    await this.completion;
  }

  toString(): string {
    return `Thread[${this.name},5,main]`;
  }
}

/**
 * Run `fn` with `thread` as the current thread. This is how a pool re-enters one
 * of its workers for the next task, which on the JVM happens implicitly because
 * the worker *is* the thread that runs the task.
 */
export function runAsThread<T>(thread: Thread, fn: () => T): T {
  return threadLocal.run(thread, fn);
}

/** The thread the process starts on; `Thread.currentThread()` outside any task. */
export const MAIN_THREAD = new Thread(null, 'main');

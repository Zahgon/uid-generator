/*
 * Reimplementation shim: the `java.util.concurrent.atomic` classes the
 * component relies on.
 *
 * Node runs one JavaScript thread, so the atomicity these classes provide in
 * the JVM is already guaranteed by the absence of preemption inside a
 * synchronous block. What is *not* free is their arithmetic: `AtomicLong`
 * counts in 64-bit two's complement and `AtomicInteger` in 32-bit, both
 * wrapping on overflow, and `updateAndGet` returns the new value while
 * `getAndUpdate` returns the old one. Those are the behaviours reproduced here.
 */

import { toLong } from './long.js';

/** `java.util.concurrent.atomic.AtomicLong`. */
export class AtomicLong {
  private value: bigint;

  constructor(initialValue: bigint = 0n) {
    this.value = toLong(initialValue);
  }

  get(): bigint {
    return this.value;
  }

  set(newValue: bigint): void {
    this.value = toLong(newValue);
  }

  getAndSet(newValue: bigint): bigint {
    const previous = this.value;
    this.value = toLong(newValue);
    return previous;
  }

  compareAndSet(expect: bigint, update: bigint): boolean {
    if (this.value !== toLong(expect)) {
      return false;
    }
    this.value = toLong(update);
    return true;
  }

  incrementAndGet(): bigint {
    this.value = toLong(this.value + 1n);
    return this.value;
  }

  getAndIncrement(): bigint {
    const previous = this.value;
    this.value = toLong(this.value + 1n);
    return previous;
  }

  decrementAndGet(): bigint {
    this.value = toLong(this.value - 1n);
    return this.value;
  }

  addAndGet(delta: bigint): bigint {
    this.value = toLong(this.value + delta);
    return this.value;
  }

  updateAndGet(updateFunction: (previous: bigint) => bigint): bigint {
    this.value = toLong(updateFunction(this.value));
    return this.value;
  }

  getAndUpdate(updateFunction: (previous: bigint) => bigint): bigint {
    const previous = this.value;
    this.value = toLong(updateFunction(previous));
    return previous;
  }

  /** `AtomicLong.toString()` is `Long.toString(get())`. */
  toString(): string {
    return this.value.toString();
  }
}

/** `java.util.concurrent.atomic.AtomicInteger`. */
export class AtomicInteger {
  private value: number;

  constructor(initialValue = 0) {
    this.value = initialValue | 0;
  }

  get(): number {
    return this.value;
  }

  set(newValue: number): void {
    this.value = newValue | 0;
  }

  compareAndSet(expect: number, update: number): boolean {
    if (this.value !== (expect | 0)) {
      return false;
    }
    this.value = update | 0;
    return true;
  }

  incrementAndGet(): number {
    this.value = (this.value + 1) | 0;
    return this.value;
  }

  updateAndGet(updateFunction: (previous: number) => number): number {
    this.value = updateFunction(this.value) | 0;
    return this.value;
  }

  toString(): string {
    return String(this.value);
  }
}

/** `java.util.concurrent.atomic.AtomicBoolean`. */
export class AtomicBoolean {
  private value: boolean;

  constructor(initialValue = false) {
    this.value = initialValue;
  }

  get(): boolean {
    return this.value;
  }

  set(newValue: boolean): void {
    this.value = newValue;
  }

  compareAndSet(expect: boolean, update: boolean): boolean {
    if (this.value !== expect) {
      return false;
    }
    this.value = update;
    return true;
  }

  toString(): string {
    return String(this.value);
  }
}

/*
 * Reimplementation shim: `org.springframework.util.Assert`, the two assertions
 * the component uses. Both raise `IllegalArgumentException` carrying the caller's
 * message verbatim — several of those messages are quoted in the task contract.
 */

/** Thrown where Spring throws `java.lang.IllegalArgumentException`. */
export class IllegalArgumentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalArgumentException';
  }
}

/** `Assert.isTrue(boolean, String)`. */
export function isTrue(expression: boolean, message: string): void {
  if (!expression) {
    throw new IllegalArgumentException(message);
  }
}

/** `Assert.notNull(Object, String)`. */
export function notNull<T>(object: T, message: string): asserts object is NonNullable<T> {
  if (object === null || object === undefined) {
    throw new IllegalArgumentException(message);
  }
}

/** Explicitly typed so `Assert.notNull` keeps its assertion signature at call sites. */
export interface AssertApi {
  isTrue(expression: boolean, message: string): void;
  notNull<T>(object: T, message: string): asserts object is NonNullable<T>;
}

export const Assert: AssertApi = { isTrue, notNull };

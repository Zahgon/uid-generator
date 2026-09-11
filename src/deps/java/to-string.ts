/*
 * Reimplementation shim: `java.lang.String.valueOf(Object)`.
 *
 * Java renders any object by calling its `toString()`, and several classes here
 * override it into part of the contract — `BitsAllocator`, `RingBuffer`,
 * `WorkerNodeEntity`. The call sites hold `unknown`, so the conversion is
 * spelled out once, here, instead of being asserted away at each of them.
 */

/**
 * The object's own `toString`, or `undefined` when it only inherits Object's —
 * which would render "[object Object]", something the original never printed.
 */
function ownToString(value: object): (() => string) | undefined {
  const candidate: unknown = (value as { toString?: unknown }).toString;
  if (typeof candidate === 'function' && candidate !== Object.prototype.toString) {
    return candidate as () => string;
  }
  return undefined;
}

/** `String.valueOf(Object)`: `"null"` for null, otherwise the object's own rendering. */
export function javaToString(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  switch (typeof value) {
    case 'object': {
      const render = ownToString(value);
      return render === undefined ? JSON.stringify(value) : render.call(value);
    }
    case 'string':
      return value;
    case 'symbol':
      return value.toString();
    case 'function':
      return value.name;
    case 'number':
    case 'bigint':
    case 'boolean':
      return value.toString();
    default:
      return 'null';
  }
}

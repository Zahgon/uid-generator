/*
 * Reimplementation shim: the subset of `java.lang.String.format` this component
 * uses — `%s`, `%d` and the `%%` escape. Both call sites are user-visible
 * strings (`UidGenerator.parseUID` and the "Clock moved backwards" message), so
 * the conversions have to behave the way the JDK's do: `%d` rejects a
 * non-integral argument rather than silently stringifying it.
 */

import { javaToString } from './to-string.js';

/** Thrown where the JDK throws `java.util.IllegalFormatConversionException`. */
export class IllegalFormatConversionException extends Error {
  constructor(conversion: string, argument: unknown) {
    super(`${conversion} != ${typeof argument}`);
    this.name = 'IllegalFormatConversionException';
  }
}

/** Thrown where the JDK throws `java.util.MissingFormatArgumentException`. */
export class MissingFormatArgumentException extends Error {
  constructor(format: string) {
    super(`Format specifier '${format}'`);
    this.name = 'MissingFormatArgumentException';
  }
}

function toStringArgument(argument: unknown): string {
  return javaToString(argument);
}

function toIntegralArgument(argument: unknown): string {
  if (typeof argument === 'bigint') {
    return argument.toString();
  }
  if (typeof argument === 'number' && Number.isInteger(argument)) {
    return argument.toString();
  }
  throw new IllegalFormatConversionException('d', argument);
}

/** `String.format(format, ...args)` restricted to `%s`, `%d` and `%%`. */
export function format(formatString: string, ...args: readonly unknown[]): string {
  let index = 0;
  return formatString.replace(/%[sd%]/g, (specifier) => {
    if (specifier === '%%') {
      return '%';
    }
    if (index >= args.length) {
      throw new MissingFormatArgumentException(specifier);
    }
    const argument = args[index];
    index += 1;
    return specifier === '%d' ? toIntegralArgument(argument) : toStringArgument(argument);
  });
}

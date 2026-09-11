/*
 * Reimplementation shim: `org.apache.commons.lang.time.DateUtils.parseDate` and
 * `org.apache.commons.lang.time.DateFormatUtils.format`.
 *
 * `parseDate` tries each pattern with a lenient `SimpleDateFormat` and accepts
 * the first that consumes the whole input; if none does it throws
 * `ParseException("Unable to parse the date: " + str)`.
 */

import { ParseException, formatPattern, parsePattern } from '../java/java-date.js';

/** `DateUtils.parseDate(String, String[])`. */
export function parseDate(str: string | null | undefined, parsePatterns: readonly string[]): Date {
  if (str === null || str === undefined || parsePatterns.length === 0) {
    throw new Error('Date and Patterns must not be null');
  }
  for (const pattern of parsePatterns) {
    const parsed = parsePattern(str, pattern);
    if (parsed !== null) {
      return parsed;
    }
  }
  throw new ParseException(`Unable to parse the date: ${str}`, -1);
}

/** `DateFormatUtils.format(Date, String)`. */
export function format(date: Date, pattern: string): string {
  return formatPattern(date, pattern);
}

export const DateFormatUtils = { format } as const;

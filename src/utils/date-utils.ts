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

import { DateFormatUtils, parseDate as commonsParseDate } from '../deps/commons-lang/date-utils.js';

/**
 * DateUtils provides date formatting, parsing
 *
 * The Java original extends `org.apache.commons.lang.time.DateUtils`; the
 * commons-lang members it actually inherits are `parseDate` and, transitively,
 * `DateFormatUtils.format`, both of which live in the shim it delegates to.
 *
 * @author yutianbao
 */

/**
 * Patterns
 */
export const DAY_PATTERN = 'yyyy-MM-dd';
export const DATETIME_PATTERN = 'yyyy-MM-dd HH:mm:ss';
export const DATETIME_MS_PATTERN = 'yyyy-MM-dd HH:mm:ss.SSS';

/**
 * Parse date without Checked exception
 *
 * @throws Error when a ParseException occurred
 */
export function parseDate(str: string, pattern: string): Date {
  try {
    return commonsParseDate(str, [pattern]);
  } catch (e) {
    throw new Error(String(e), { cause: e });
  }
}

/**
 * Parse date by 'yyyy-MM-dd' pattern
 */
export function parseByDayPattern(str: string): Date {
  return parseDate(str, DAY_PATTERN);
}

/**
 * Parse date by 'yyyy-MM-dd HH:mm:ss' pattern
 */
export function parseByDateTimePattern(str: string): Date {
  return parseDate(str, DATETIME_PATTERN);
}

/**
 * Format date into string
 */
export function formatDate(date: Date, pattern: string): string {
  return DateFormatUtils.format(date, pattern);
}

/**
 * Format date by 'yyyy-MM-dd' pattern
 */
export function formatByDayPattern(date: Date | null | undefined): string | null {
  if (date !== null && date !== undefined) {
    return DateFormatUtils.format(date, DAY_PATTERN);
  }
  return null;
}

/**
 * Format date by 'yyyy-MM-dd HH:mm:ss' pattern
 */
export function formatByDateTimePattern(date: Date): string {
  return DateFormatUtils.format(date, DATETIME_PATTERN);
}

/**
 * Get current day using format date by 'yyyy-MM-dd' pattern
 *
 * @author yebo
 */
export function getCurrentDayByDayPattern(): string | null {
  return formatByDayPattern(new Date());
}

/** The `DEFAULT_DATE` constant: 1970-01-01 in the default time zone. */
export const DEFAULT_DATE: Date = parseByDayPattern('1970-01-01');

export const DateUtils = {
  DAY_PATTERN,
  DATETIME_PATTERN,
  DATETIME_MS_PATTERN,
  DEFAULT_DATE,
  parseDate,
  parseByDayPattern,
  parseByDateTimePattern,
  formatDate,
  formatByDayPattern,
  formatByDateTimePattern,
  getCurrentDayByDayPattern,
} as const;

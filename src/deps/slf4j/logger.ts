/*
 * Reimplementation shim: slf4j 1.7 bound to logback-classic 1.1 in its default,
 * unconfigured state.
 *
 * The project ships no `logback.xml`, so logback's BasicConfigurator applies:
 * root level DEBUG, one ConsoleAppender writing to `System.out`, and the
 * pattern
 *
 *     %d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n
 *
 * Every line the component emits goes through this, and the component's log is
 * part of what a user sees, so the layout is reproduced exactly — including
 * `%-5level`'s left-aligned 5-character field and `%logger{36}`'s package
 * abbreviation.
 */

import { formatPattern } from '../java/java-date.js';
import { javaToString } from '../java/to-string.js';
import { Thread } from '../java/thread.js';

export enum Level {
  TRACE = 0,
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
}

const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  [Level.TRACE]: 'TRACE',
  [Level.DEBUG]: 'DEBUG',
  [Level.INFO]: 'INFO',
  [Level.WARN]: 'WARN',
  [Level.ERROR]: 'ERROR',
};

/** logback's default root level when no configuration file is present. */
const DEFAULT_ROOT_LEVEL = Level.DEBUG;

/** The target width of `%logger{36}`. */
const LOGGER_NAME_TARGET_LENGTH = 36;

let rootLevel: Level = DEFAULT_ROOT_LEVEL;
let output: (line: string) => void = (line) => {
  process.stdout.write(line);
};

/**
 * The root logger's level. Standing in for editing `logback.xml`, which is what
 * a deployment would do; the default stays DEBUG so an unconfigured run behaves
 * as the original does.
 */
export function setRootLevel(level: Level): void {
  rootLevel = level;
}

export function getRootLevel(): Level {
  return rootLevel;
}

/** Redirect the console appender. Used by the suite to capture emitted lines. */
export function setAppender(appender: (line: string) => void): void {
  output = appender;
}

/** Restore the console appender to logback's default target, `System.out`. */
export function resetAppender(): void {
  output = (line) => {
    process.stdout.write(line);
  };
}

/**
 * logback's `TargetLengthBasedClassNameAbbreviator`: shorten package segments
 * to their first character, left to right, until the name fits the target
 * length; leave the remaining segments and the class name itself intact.
 */
export function abbreviateLoggerName(name: string, targetLength = LOGGER_NAME_TARGET_LENGTH): string {
  const dotIndexes: number[] = [];
  for (let i = 0; i < name.length; i += 1) {
    if (name[i] === '.') {
      dotIndexes.push(i);
    }
  }
  if (dotIndexes.length === 0) {
    return name;
  }

  let toTrim = name.length - targetLength;
  const segments: string[] = [];
  let previousDot = -1;
  for (const dotIndex of dotIndexes) {
    const available = dotIndex - previousDot - 1;
    const keep = toTrim > 0 ? Math.min(available, 1) : available;
    toTrim -= available - keep;
    segments.push(name.slice(previousDot + 1, previousDot + 1 + keep));
    previousDot = dotIndex;
  }
  segments.push(name.slice(previousDot + 1));
  return segments.join('.');
}

/**
 * slf4j's `{}` anchor substitution. Anchors are filled positionally; `\{}`
 * escapes an anchor; a trailing argument left over after the anchors run out is
 * treated as the throwable and rendered as a stack trace, not as text.
 */
export function formatMessage(pattern: string, args: readonly unknown[]): { message: string; throwable: unknown } {
  let index = 0;
  let message = '';
  let cursor = 0;
  while (cursor < pattern.length) {
    const anchor = pattern.indexOf('{}', cursor);
    if (anchor === -1 || index >= args.length) {
      message += pattern.slice(cursor);
      break;
    }
    if (anchor > 0 && pattern[anchor - 1] === '\\') {
      message += `${pattern.slice(cursor, anchor - 1)}{}`;
      cursor = anchor + 2;
      continue;
    }
    message += pattern.slice(cursor, anchor);
    message += renderArgument(args[index]);
    index += 1;
    cursor = anchor + 2;
  }
  const throwable = index < args.length ? args[args.length - 1] : undefined;
  return { message, throwable };
}

function renderArgument(argument: unknown): string {
  return javaToString(argument);
}

function renderThrowable(throwable: unknown): string {
  if (throwable instanceof Error) {
    return `\n${throwable.stack ?? `${throwable.name}: ${throwable.message}`}`;
  }
  return `\n${javaToString(throwable)}`;
}

/** `org.slf4j.Logger`, bound to logback's default console layout. */
export class Logger {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  isTraceEnabled(): boolean {
    return rootLevel <= Level.TRACE;
  }

  isDebugEnabled(): boolean {
    return rootLevel <= Level.DEBUG;
  }

  isInfoEnabled(): boolean {
    return rootLevel <= Level.INFO;
  }

  isWarnEnabled(): boolean {
    return rootLevel <= Level.WARN;
  }

  isErrorEnabled(): boolean {
    return rootLevel <= Level.ERROR;
  }

  trace(pattern: string, ...args: unknown[]): void {
    this.log(Level.TRACE, pattern, args);
  }

  debug(pattern: string, ...args: unknown[]): void {
    this.log(Level.DEBUG, pattern, args);
  }

  info(pattern: string, ...args: unknown[]): void {
    this.log(Level.INFO, pattern, args);
  }

  warn(pattern: string, ...args: unknown[]): void {
    this.log(Level.WARN, pattern, args);
  }

  error(pattern: string, ...args: unknown[]): void {
    this.log(Level.ERROR, pattern, args);
  }

  private log(level: Level, pattern: string, args: readonly unknown[]): void {
    if (level < rootLevel) {
      return;
    }
    const { message, throwable } = formatMessage(pattern, args);
    const timestamp = formatPattern(new Date(), 'HH:mm:ss.SSS');
    const threadName = Thread.currentThread().getName();
    const levelName = LEVEL_NAMES[level].padEnd(5, ' ');
    const loggerName = abbreviateLoggerName(this.name);
    const suffix = throwable === undefined ? '' : renderThrowable(throwable);
    output(`${timestamp} [${threadName}] ${levelName} ${loggerName} - ${message}${suffix}\n`);
  }
}

const loggers = new Map<string, Logger>();

/** `org.slf4j.LoggerFactory`. */
export const LoggerFactory = {
  getLogger(name: string): Logger {
    let logger = loggers.get(name);
    if (logger === undefined) {
      logger = new Logger(name);
      loggers.set(name, logger);
    }
    return logger;
  },
} as const;
